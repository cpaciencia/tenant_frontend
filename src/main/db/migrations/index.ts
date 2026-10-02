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
  },
  {
    name: '0009-cash-sessions',
    up: async ({ context: db }) => {
      // Per-cashier till session ("caja"). A cashier opens her own caja with a float;
      // every sale she makes is tagged to it; she closes it with a cash count (arqueo).
      // Several cajas can be open at once on one terminal (shift overlap): each sale
      // lands in the caja of the cashier who made it, and each reconciles only her own.
      db.exec(`
        CREATE TABLE cash_sessions (
          id                    TEXT PRIMARY KEY,
          terminal_id           TEXT NOT NULL,
          cashier_user_id       TEXT,
          cashier_name          TEXT NOT NULL,
          opened_at             TEXT NOT NULL,
          opening_float_cents   INTEGER NOT NULL DEFAULT 0,
          status                TEXT NOT NULL DEFAULT 'open',
          closed_at             TEXT,
          expected_cash_cents   INTEGER,
          counted_cash_cents    INTEGER,
          difference_cents      INTEGER,
          closing_float_cents   INTEGER,
          sales_count           INTEGER NOT NULL DEFAULT 0,
          total_cents           INTEGER NOT NULL DEFAULT 0,
          tenders_json          TEXT NOT NULL DEFAULT '{}',
          breakdown_json        TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX idx_cash_sessions_status ON cash_sessions (status);

        ALTER TABLE sales ADD COLUMN cash_session_id TEXT;
        ALTER TABLE sales ADD COLUMN cashier_user_id TEXT;
        ALTER TABLE sales ADD COLUMN cashier_name    TEXT;
        CREATE INDEX idx_sales_cash_session ON sales (cash_session_id);
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS cash_sessions;')
    }
  },
  {
    name: '0010-unify-cierre',
    up: async ({ context: db }) => {
      // Unify the two closings into one. The cashier's caja (arqueo) becomes the
      // ONLY cierre and now carries the fiscal per-terminal sequential Z number.
      // The separate `z_closures` table is dropped: sales are already sealed by
      // their `cash_session_id` (stamped at sale time in createSale), so nothing
      // needs re-linking. The now-unused `sales.z_closure_id` column is left in
      // place (SQLite can't drop a column pre-3.35 without a table rebuild) — it
      // is simply no longer written.
      db.exec(`
        ALTER TABLE cash_sessions ADD COLUMN z_number INTEGER;
        DROP TABLE IF EXISTS z_closures;
      `)
    },
    down: async ({ context: db }) => {
      // Dev rollback: recreate z_closures. The z_number column is left dangling
      // (SQLite can't drop columns pre-3.35 without a rebuild).
      db.exec(`
        CREATE TABLE IF NOT EXISTS z_closures (
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
      `)
    }
  },
  {
    name: '0011-shift-cajas',
    up: async ({ context: db }) => {
      // A caja now belongs to a SHIFT (turno) on a business date, not to a cashier:
      // one open caja per terminal, everyone on duty sells into it with their own
      // user (sales.cashier_* now records the seller). The cierre also stores who
      // closed it, the per-client fiado list and the per-seller totals. The caja a
      // cierre leaves open has no responsible until someone accepts it at login.
      // `sales.client_name` snapshots who a fiado was credited to.
      db.exec(`
        ALTER TABLE cash_sessions ADD COLUMN shift_id          TEXT;
        ALTER TABLE cash_sessions ADD COLUMN shift_name        TEXT;
        ALTER TABLE cash_sessions ADD COLUMN business_date     TEXT;
        ALTER TABLE cash_sessions ADD COLUMN responsible_user_id TEXT;
        ALTER TABLE cash_sessions ADD COLUMN responsible_name    TEXT;
        ALTER TABLE cash_sessions ADD COLUMN accepted_at       TEXT;
        ALTER TABLE cash_sessions ADD COLUMN closed_by_user_id TEXT;
        ALTER TABLE cash_sessions ADD COLUMN closed_by_name    TEXT;
        ALTER TABLE cash_sessions ADD COLUMN fiados_json       TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE cash_sessions ADD COLUMN sellers_json      TEXT NOT NULL DEFAULT '[]';
        CREATE INDEX idx_cash_sessions_terminal_status ON cash_sessions (terminal_id, status);

        ALTER TABLE sales ADD COLUMN client_name TEXT;
      `)
    },
    down: async () => {
      // Dev rollback: the added columns are left dangling (SQLite can't drop
      // columns pre-3.35 without a table rebuild).
    }
  },
  {
    name: '0012-float-adjustments',
    up: async ({ context: db }) => {
      // The drawer float of an open caja can be corrected (e.g. the arriving
      // cashier counts it on acceptance). Every correction is kept for the cierre:
      // who, when, from → to. JSON array, like the other cierre details.
      db.exec(
        `ALTER TABLE cash_sessions ADD COLUMN float_adjustments_json TEXT NOT NULL DEFAULT '[]';`
      )
    },
    down: async () => {
      // Dev rollback: column left dangling (no DROP COLUMN pre-3.35).
    }
  },
  {
    name: '0013-pending-items-audit',
    up: async ({ context: db }) => {
      // pending_items: lines sold without a catalog product ("Producto rápido" or a
      // scanned barcode that wasn't found), waiting to be completed into a real
      // product or dismissed.
      // audit_events: append-only log of everything that happens on the till
      // (sales, voids, logins, cajas…), synced to the backend for analytics.
      db.exec(`
        CREATE TABLE pending_items (
          id                  TEXT PRIMARY KEY,
          terminal_id         TEXT NOT NULL,
          sale_id             TEXT NOT NULL,
          ticket_number       TEXT NOT NULL,
          kind                TEXT NOT NULL,
          barcode             TEXT,
          name                TEXT,
          category_id         TEXT,
          price_cents         INTEGER NOT NULL,
          quantity            REAL NOT NULL,
          created_at          TEXT NOT NULL,
          created_by_user_id  TEXT,
          created_by_name     TEXT NOT NULL,
          status              TEXT NOT NULL DEFAULT 'pending',
          product_id          TEXT,
          resolved_at         TEXT,
          resolved_by_user_id TEXT,
          resolved_by_name    TEXT
        );
        CREATE INDEX idx_pending_items_status ON pending_items (status, created_at);

        CREATE TABLE audit_events (
          id              TEXT PRIMARY KEY,
          occurred_at     TEXT NOT NULL,
          terminal_id     TEXT NOT NULL,
          user_id         TEXT,
          user_name       TEXT,
          type            TEXT NOT NULL,
          cash_session_id TEXT,
          entity_id       TEXT,
          data_json       TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX idx_audit_events_time ON audit_events (occurred_at);
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS audit_events; DROP TABLE IF EXISTS pending_items;')
    }
  },
  {
    name: '0014-parked-tickets',
    up: async ({ context: db }) => {
      // Tickets set aside unpaid (to serve another customer) and resumed later.
      // Local to the till; parking/resuming/discarding is recorded in the audit log.
      db.exec(`
        CREATE TABLE parked_tickets (
          id                 TEXT PRIMARY KEY,
          terminal_id        TEXT NOT NULL,
          draft_id           TEXT,
          parked_at          TEXT NOT NULL,
          parked_by_user_id  TEXT,
          parked_by_name     TEXT NOT NULL,
          lines_json         TEXT NOT NULL,
          total_cents        INTEGER NOT NULL
        );
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS parked_tickets;')
    }
  },
  {
    name: '0015-cash-movements',
    up: async ({ context: db }) => {
      // Cash in/out of the drawer that is not a sale: supplier payments and money
      // put into / taken out of the drawer. Part of the arqueo; sealed into
      // the cierre (movements_json) like the other details.
      db.exec(`
        CREATE TABLE cash_movements (
          id              TEXT PRIMARY KEY,
          terminal_id     TEXT NOT NULL,
          cash_session_id TEXT NOT NULL,
          kind            TEXT NOT NULL,
          amount_cents    INTEGER NOT NULL,
          supplier        TEXT,
          document        TEXT,
          note            TEXT,
          user_id         TEXT,
          user_name       TEXT NOT NULL,
          created_at      TEXT NOT NULL
        );
        CREATE INDEX idx_cash_movements_session ON cash_movements (cash_session_id);
        ALTER TABLE cash_sessions ADD COLUMN movements_json TEXT NOT NULL DEFAULT '[]';
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS cash_movements;')
    }
  },
  {
    name: '0016-suppliers-invoices',
    up: async ({ context: db }) => {
      // Suppliers mirror (pulled from the backend; a till may add one offline) and
      // the invoice state of each supplier payment. A payment's invoice is stored
      // by the server; until then it is 'pending' and the caja cannot be closed.
      // Payments recorded before this feature have no requirement (NULL).
      db.exec(`
        CREATE TABLE suppliers (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          active     INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX ux_suppliers_name ON suppliers (name COLLATE NOCASE);
        ALTER TABLE cash_movements ADD COLUMN supplier_id TEXT;
        ALTER TABLE cash_movements ADD COLUMN invoice_status TEXT;
        ALTER TABLE cash_movements ADD COLUMN invoice_file_name TEXT;
        ALTER TABLE cash_movements ADD COLUMN invoice_uploaded_at TEXT;
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS suppliers;')
    }
  },
  {
    name: '0017-pending-invoices-open-caja',
    up: async ({ context: db }) => {
      // Supplier payments recorded in the still-open caja before invoices existed
      // (or by an outdated app) also need their invoice: mark them pending. Those
      // whose invoice is already on the server get reconciled by the till.
      db.exec(`
        UPDATE cash_movements SET invoice_status = 'pending'
         WHERE kind = 'supplier_payment' AND invoice_status IS NULL
           AND cash_session_id IN (SELECT id FROM cash_sessions WHERE status = 'open');
      `)
    },
    down: async () => {}
  },
  {
    name: '0018-clients-account-payments',
    up: async ({ context: db }) => {
      // "A cuenta" clients mirror (pulled; a till may add one offline) and the
      // payments of their debt (cobros de cuentas): cash/card into the caja of the
      // day, NOT a sale. remote_balance_cents = what the client owes on OTHER
      // terminals (from the server); this till adds its own local movements.
      db.exec(`
        CREATE TABLE clients (
          id                   TEXT PRIMARY KEY,
          name                 TEXT NOT NULL,
          detail               TEXT,
          phone                TEXT,
          active               INTEGER NOT NULL DEFAULT 1,
          remote_balance_cents INTEGER NOT NULL DEFAULT 0,
          updated_at           TEXT NOT NULL
        );
        CREATE TABLE account_payments (
          id               TEXT PRIMARY KEY,
          payment_number   TEXT NOT NULL UNIQUE,
          terminal_id      TEXT NOT NULL,
          payment_year     INTEGER NOT NULL,
          payment_sequence INTEGER NOT NULL,
          client_id        TEXT NOT NULL,
          client_name      TEXT NOT NULL,
          cash_cents       INTEGER NOT NULL,
          card_cents       INTEGER NOT NULL,
          total_cents      INTEGER NOT NULL,
          cash_session_id  TEXT NOT NULL,
          sale_id          TEXT,
          user_id          TEXT,
          user_name        TEXT NOT NULL,
          note             TEXT,
          created_at       TEXT NOT NULL,
          UNIQUE (terminal_id, payment_year, payment_sequence)
        );
        CREATE INDEX idx_account_payments_session ON account_payments (cash_session_id);
        CREATE INDEX idx_account_payments_client ON account_payments (client_id);
        CREATE INDEX idx_sales_client ON sales (client_id);
        ALTER TABLE cash_sessions ADD COLUMN settlements_json TEXT NOT NULL DEFAULT '[]';
      `)
    },
    down: async ({ context: db }) => {
      db.exec('DROP TABLE IF EXISTS account_payments; DROP TABLE IF EXISTS clients;')
    }
  }
]
