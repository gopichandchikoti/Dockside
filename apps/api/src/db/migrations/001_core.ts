import type { Migration } from './types';

export const core: Migration = {
  id: 1,
  name: 'core_users_sessions_audit',
  sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );

    CREATE TABLE sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);
    CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
      ip TEXT,
      detail TEXT
    );
    CREATE INDEX idx_audit_ts ON audit_log(ts);
  `,
};
