/**
 * `better-sqlite3-multiple-ciphers` is an API-compatible fork of `better-sqlite3`
 * (same surface, plus encryption via `PRAGMA key`). It ships no own types, so we
 * re-export the upstream `@types/better-sqlite3` declarations under its name.
 */
declare module 'better-sqlite3-multiple-ciphers' {
  import Database from 'better-sqlite3'
  export = Database
}
