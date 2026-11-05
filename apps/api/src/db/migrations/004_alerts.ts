import type { Migration } from './types';
export const alerts: Migration = {
  id: 4,
  name: 'alerts_and_channels',
  sql: `
  CREATE TABLE alert_rules (id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, metric TEXT NOT NULL, operator TEXT NOT NULL, threshold REAL NOT NULL,
    duration_seconds INTEGER NOT NULL, enabled INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'ok',
    pending_since INTEGER, silenced_until INTEGER, value REAL);
  CREATE TABLE alert_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    ts TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    secret TEXT NOT NULL, last_delivery TEXT);
  CREATE INDEX idx_alert_events ON alert_events(id DESC);
`,
};
