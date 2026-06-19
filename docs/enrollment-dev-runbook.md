# Terminal enrolment — developer runbook

How a terminal gets enrolled, and how to recover when the client and the backend
get out of sync during development. Read this before resetting anything.

## The model (why order matters)

Enrolment is a **one-time key exchange**. A terminal is registered on the
backend, which mints a one-time `enrollment_code`. The client redeems that code
and the backend issues, **exactly once**:

- a sync `token` (only its SHA-256 is stored server-side), and
- a `db_key` — the AES key the client uses to open/encrypt its local SQLite
  (`camping-pos.db`, SQLCipher-compatible `PRAGMA key`).

The raw `token` and `db_key` are returned **only in the enrol response**. The
backend keeps a custodian copy of `db_key`; the client caches it in the OS
keychain (`terminal.enc`). After that, the client's `.db` is cryptographically
bound to that one key.

**Consequence:** the client `.db` and the server's issued key are a matched
pair. If either side is reset/wiped independently, the key no longer opens the
file and you get `SqliteError: file is not a database` (or `409 already
enrolled`). Always reset **both sides together** — see Recovery below.

## State locations

### Backend (`tenant_backend`, Postgres table `terminals`)

- Lifecycle: `pending` (registered, has `enrollment_code`) → `enrolled`
  (code consumed; `token_hash` + `db_key` issued) → `revoked` (kill switch).
- Code is **one-time**: `enroll` nulls `enrollment_code` on success
  (`Terminal.markEnrolled`).
- Endpoints (`/api/terminals`, not yet behind auth):
  - `POST /api/terminals` — admin registers a terminal, returns the one-time code.
  - `POST /api/terminals/enroll` — terminal redeems code, gets `token` + `dbKey`.

### Client (Electron, under `app.getPath('userData')`)

On macOS dev that path is `~/Library/Application Support/tenant_frontend/`.

- `camping-pos.db` (+ `-wal`, `-shm`) — the encrypted local DB.
- `terminal.enc` — sealed credentials (`token` + `db_key`), keychain-encrypted.
- `bootstrap.json` — pre-enrolment config (just `syncApiUrl`); safe to keep.

If `terminal.enc` is absent the app shows Setup; if present it calls
`startRuntime(dbKey)` and opens the DB at boot.

## Happy path

1. Register the terminal (admin). You can hit the endpoint:
   ```bash
   curl -s -X POST http://localhost:8080/api/terminals \
     -H 'Content-Type: application/json' \
     -d '{"terminalId":"T01","name":"Caja principal"}'
   ```
   …or insert the `pending` row by hand and choose a human-friendly code (see
   Recovery). Note the `enrollmentCode`.
2. `npm run dev`, go to Setup, enter Terminal ID + code.
3. Client redeems it, stores `terminal.enc`, creates `camping-pos.db`, enters POS.

Do **not** call `/api/terminals/enroll` yourself with curl unless you intend to
throw the result away — it consumes the code and the issued `db_key` must reach
the _client_, not your terminal.

## Recovery: "file is not a database" / "terminal already enrolled"

Both symptoms mean client and server disagree about the key. Fix by resetting
**both** sides, then re-enrol.

1. Reset the backend row to `pending` with a fresh code (DB name/creds below):
   ```sql
   UPDATE terminals
      SET status='pending', enrollment_code='CAMPING1',
          token_hash=NULL, db_key=NULL, enrolled_at=NULL, updated_at=now()
    WHERE terminal_id='T01';
   ```
2. Wipe the client's bound state (keep `bootstrap.json`):
   ```bash
   UD="$HOME/Library/Application Support/tenant_frontend"
   rm -f "$UD"/camping-pos.db "$UD"/camping-pos.db-wal \
         "$UD"/camping-pos.db-shm "$UD"/terminal.enc
   ```
3. `npm run dev` → Setup → enrol with the code from step 1. **Don't touch the
   client files afterwards**, or you break the new pair again.

> The client also exposes an in-app reset (`EnrollmentService.reset()` clears
> `terminal.enc`); pair it with the backend reset above.

## Golden rules

- Reset/wipe **both** sides, never just one.
- The `db_key` is shared once, at enrolment; a wiped `.db` cannot be reopened
  with a newly issued key — re-enrol from scratch.
- The enrolment code is one-time; after a successful enrol it's gone.
