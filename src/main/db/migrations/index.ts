import type { MigrationParams } from 'umzug'
import type { DB } from '../connection'

type Migration = {
  name: string
  up: (params: MigrationParams<DB>) => Promise<void>
  down: (params: MigrationParams<DB>) => Promise<void>
}

/**
 * Migrations are declared in-code (not glob-loaded) so they bundle cleanly into
 * the Electron main process. Each `name` MUST be unique and ordered; new
 * migrations are appended with an incrementing numeric prefix.
 *
 * Conventions:
 * - Every table's primary key `id` is a UUIDv7 stored as TEXT.
 * - Monetary values are stored as INTEGER cents to avoid floating-point drift.
 * - Timestamps are ISO-8601 UTC strings.
 */
export const migrations: Migration[] = [
  {
    name: '0001-initial-schema',
    up: async ({ context: db }) => {
      db.exec(`
        CREATE TABLE products (
          id          TEXT PRIMARY KEY,
          barcode     TEXT UNIQUE,
          name        TEXT NOT NULL,
          price_cents INTEGER NOT NULL DEFAULT 0,
          tax_rate    REAL NOT NULL DEFAULT 0,
          active      INTEGER NOT NULL DEFAULT 1,
          legacy_id   TEXT,
          created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX idx_products_barcode ON products (barcode);

        CREATE TABLE sales (
          id              TEXT PRIMARY KEY,
          ticket_number   TEXT NOT NULL UNIQUE,
          terminal_id     TEXT NOT NULL,
          ticket_year     INTEGER NOT NULL,
          ticket_sequence INTEGER NOT NULL,
          total_cents     INTEGER NOT NULL DEFAULT 0,
          items_json      TEXT NOT NULL DEFAULT '[]',
          status          TEXT NOT NULL DEFAULT 'completed',
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          -- Guarantees no two tickets share a sequence on the same terminal/year,
          -- even under a race: the second INSERT fails the UNIQUE constraint.
          UNIQUE (terminal_id, ticket_year, ticket_sequence)
        );

        CREATE TABLE sync_queue (
          id          TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id   TEXT NOT NULL,
          operation   TEXT NOT NULL,
          payload     TEXT NOT NULL,
          synced      INTEGER NOT NULL DEFAULT 0,
          attempts    INTEGER NOT NULL DEFAULT 0,
          last_error  TEXT,
          created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          synced_at   TEXT
        );
        -- The sync worker polls pending rows oldest-first.
        CREATE INDEX idx_sync_queue_pending ON sync_queue (synced, created_at);
      `)
    },
    down: async ({ context: db }) => {
      db.exec(`
        DROP TABLE IF EXISTS sync_queue;
        DROP TABLE IF EXISTS sales;
        DROP TABLE IF EXISTS products;
      `)
    }
  },
  {
    name: '0002-settings',
    up: async ({ context: db }) => {
      // Per-terminal configuration kept as a single JSON document under the
      // 'app' key. One row keeps reads/writes trivial and lets new fields be
      // added without a schema change (missing fields fall back to defaults).
      db.exec(`
        CREATE TABLE settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS settings;')
    }
  },
  {
    name: '0003-users',
    up: async ({ context: db }) => {
      // Local mirror of the central user directory, pulled down from the backend.
      // `password_hash` lets login be verified OFFLINE (BCrypt); `permissions` is
      // the user's effective permission keys (resolved server-side) stored as a
      // JSON array, so the POS enforces the same can() offline as the web online.
      db.exec(`
        CREATE TABLE users (
          id            TEXT PRIMARY KEY,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          full_name     TEXT,
          role          TEXT NOT NULL DEFAULT 'CASHIER',
          active        INTEGER NOT NULL DEFAULT 1,
          permissions   TEXT NOT NULL DEFAULT '[]',
          updated_at    TEXT NOT NULL
        );
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS users;')
    }
  },
  {
    name: '0004-categories',
    up: async ({ context: db }) => {
      // Local mirror of the central category tree (pulled from the backend), plus
      // a category link on products. Like the other mirrors, there are NO foreign
      // keys: these are projections of backend-owned data and rows may arrive in
      // any order, so referential enforcement (foreign_keys = ON) must not reject
      // them. `accounting_group_id` is the caja a category rolls up into (used by
      // the Z-report); `parent_id` makes the two-level tree.
      db.exec(`
        CREATE TABLE categories (
          id                  TEXT PRIMARY KEY,
          name                TEXT NOT NULL,
          parent_id           TEXT,
          accounting_group_id TEXT NOT NULL,
          color               TEXT,
          icon                TEXT,
          active              INTEGER NOT NULL DEFAULT 1,
          updated_at          TEXT NOT NULL
        );
        CREATE INDEX idx_categories_parent ON categories (parent_id);

        ALTER TABLE products ADD COLUMN category_id TEXT;
        CREATE INDEX idx_products_category ON products (category_id);
      `)
    },
    down: async ({ context: db }) => {
      // SQLite can't DROP a column pre-3.35 without a table rebuild; the mirror is
      // disposable, so dropping the categories table is enough for a dev rollback.
      db.exec('DROP TABLE IF EXISTS categories;')
    }
  },
  {
    name: '0005-accounting-groups',
    up: async ({ context: db }) => {
      // Local mirror of the "cajas por categoría" (pulled from the backend). The
      // Z-report (cash-up) resolves a sale line's accounting_group id to its
      // code/name from here. Like the other mirrors: no foreign keys.
      db.exec(`
        CREATE TABLE accounting_groups (
          id         TEXT PRIMARY KEY,
          code       TEXT NOT NULL,
          name       TEXT NOT NULL,
          active     INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS accounting_groups;')
    }
  },
  {
    name: '0006-z-closures',
    up: async ({ context: db }) => {
      // Cash-up (Z) closures: each one "seals" every sale not yet assigned to a
      // closure and stores the breakdown by accounting group (caja). Sales carry a
      // `z_closure_id` so "since the last close" is simply `z_closure_id IS NULL`
      // (robust, no timestamp arithmetic). `z_number` is the per-terminal sequence.
      db.exec(`
        CREATE TABLE z_closures (
          id             TEXT PRIMARY KEY,
          terminal_id    TEXT NOT NULL,
          z_number       INTEGER NOT NULL,
          closed_at      TEXT NOT NULL,
          total_cents    INTEGER NOT NULL DEFAULT 0,
          sales_count    INTEGER NOT NULL DEFAULT 0,
          breakdown_json TEXT NOT NULL DEFAULT '[]',
          created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (terminal_id, z_number)
        );

        ALTER TABLE sales ADD COLUMN z_closure_id TEXT;
        CREATE INDEX idx_sales_zclosure ON sales (z_closure_id);
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS z_closures;')
    }
  },
  {
    name: '0007-product-stock',
    up: async ({ context: db }) => {
      // Shared stock mirrored from the backend (the authoritative count). The POS
      // shows the last-pulled value; the backend decrements on sale projection.
      db.exec('ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0;')
    },
    down: async () => {
      // Disposable mirror column; a dev rollback can ignore it (SQLite can't drop
      // a column pre-3.35 without a rebuild).
    }
  },
  {
    name: '0008-sale-payment',
    up: async ({ context: db }) => {
      // How each sale was paid. cash + card + credit = total. `credit` is "a cuenta"
      // (fiado): a client's debt, NOT money in the till. client_id ties credit to a
      // customer (used once fiado lands).
      db.exec(`
        ALTER TABLE sales ADD COLUMN cash_cents   INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN card_cents   INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN credit_cents INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sales ADD COLUMN client_id    TEXT;
      `)
    },
    down: async () => {
      // Disposable in dev (SQLite can't drop columns pre-3.35 without a rebuild).
    }
  }
]
