import { defineConfig } from 'vitest/config'

// Unit tests cover the Main-process logic (db / repositories / services), which
// is pure Node — no Electron. They run against a real in-memory SQLite, so
// `better-sqlite3` must be built for the Node ABI: the `pretest` script handles
// that automatically.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
