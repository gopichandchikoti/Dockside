import type { Db } from '../db/database';
import { randomToken, sha256Hex } from '../domain/secrets';
import type { UserRecord, UserService } from './users';

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface ActiveSession {
  idHash: string;
  csrfToken: string;
  user: UserRecord;
}

interface SessionRow {
  id_hash: string;
  user_id: string;
  csrf_token: string;
  last_seen_at: string;
  expires_at: string;
}

export interface CreatedSession {
  sessionId: string;
  csrfToken: string;
  maxAgeSeconds: number;
}

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly users: UserService,
    private readonly now: () => Date,
  ) {}

  create(user: UserRecord, meta: { ip: string | null; userAgent: string | null }): CreatedSession {
    const sessionId = randomToken(32);
    const csrfToken = randomToken(24);
    const nowMs = this.now().getTime();
    this.db.run(
      `INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sha256Hex(sessionId),
        user.id,
        csrfToken,
        new Date(nowMs).toISOString(),
        new Date(nowMs).toISOString(),
        new Date(nowMs + SESSION_ABSOLUTE_MS).toISOString(),
        meta.ip,
        meta.userAgent?.slice(0, 200) ?? null,
      ],
    );
    return { sessionId, csrfToken, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 };
  }

  resolve(sessionId: string): ActiveSession | null {
    const idHash = sha256Hex(sessionId);
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id_hash = ?', [idHash]);
    if (!row) return null;
    const nowMs = this.now().getTime();
    const expired = Date.parse(row.expires_at) <= nowMs || Date.parse(row.last_seen_at) + SESSION_IDLE_MS <= nowMs;
    const user = expired ? undefined : this.users.findById(row.user_id);
    if (!user || user.disabled) {
      this.db.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
      return null;
    }
    if (nowMs - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
      this.db.run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [new Date(nowMs).toISOString(), idHash]);
    }
    return { idHash, csrfToken: row.csrf_token, user };
  }

  destroy(sessionId: string): void {
    this.db.run('DELETE FROM sessions WHERE id_hash = ?', [sha256Hex(sessionId)]);
  }

  destroyAllForUser(userId: string, keepIdHash?: string): void {
    this.db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash IS NOT ?', [userId, keepIdHash ?? null]);
  }

  purgeExpired(): number {
    const cutoff = new Date(this.now().getTime() - SESSION_IDLE_MS).toISOString();
    return this.db.run('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?', [
      this.now().toISOString(),
      cutoff,
    ]).changes;
  }
}
