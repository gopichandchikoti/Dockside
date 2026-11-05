import type { Migration } from './types';
export const metrics: Migration = {
  id: 2,
  name: 'hosts_and_metrics',
  sql: `
  CREATE TABLE hosts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, metrics_url TEXT NOT NULL, tags TEXT NOT NULL,
    is_sample INTEGER NOT NULL DEFAULT 0, last_success_at TEXT, last_error TEXT,
    failures INTEGER NOT NULL DEFAULT 0, dropped_series INTEGER NOT NULL DEFAULT 0,
    latest TEXT NOT NULL DEFAULT '{}', metadata TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE samples (
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, metric TEXT NOT NULL,
    ts INTEGER NOT NULL, value REAL, PRIMARY KEY(host_id, metric, ts)
  ) WITHOUT ROWID;
  CREATE TABLE samples_5m (
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, metric TEXT NOT NULL,
    ts INTEGER NOT NULL, total REAL NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY(host_id, metric, ts)
  ) WITHOUT ROWID;
  CREATE INDEX idx_samples_ts ON samples(ts);
  CREATE INDEX idx_rollups_ts ON samples_5m(ts);
`,
};
