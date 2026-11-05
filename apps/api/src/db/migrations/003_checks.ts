import type { Migration } from './types';
export const checks: Migration = {
  id: 3,
  name: 'service_checks',
  sql: `
  CREATE TABLE checks (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    target TEXT NOT NULL, port INTEGER);
  CREATE TABLE check_results (id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE, ts TEXT NOT NULL,
    ok INTEGER NOT NULL, latency_ms REAL NOT NULL, detail TEXT NOT NULL);
  CREATE INDEX idx_check_history ON check_results(check_id, id DESC);
`,
};
