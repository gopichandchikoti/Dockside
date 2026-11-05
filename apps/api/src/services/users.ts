import { randomUUID } from 'node:crypto';
import type { Role, UserSummary } from '@dockside/shared';
import type { Db } from '../db/database';
import { errors } from '../errors';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  failedLogins: number;
  lockedUntil: string | null;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
}

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id,
  username: r.username,
  passwordHash: r.password_hash,
  role: r.role,
  disabled: r.disabled === 1,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  failedLogins: r.failed_logins,
  lockedUntil: r.locked_until,
});

export const toSummary = (u: UserRecord): UserSummary => ({
  id: u.id,
  username: u.username,
  role: u.role,
  disabled: u.disabled,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

export class UserService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  count(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  }

  findByUsername(username: string): UserRecord | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
    return row && toRecord(row);
  }

  findById(id: string): UserRecord | undefined {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    return row && toRecord(row);
  }

  list(): UserRecord[] {
    return this.db.all<UserRow>('SELECT * FROM users ORDER BY username').map(toRecord);
  }

  create(input: { username: string; passwordHash: string; role: Role }): UserRecord {
    if (this.findByUsername(input.username)) throw errors.conflict('That username is already taken.');
    const id = randomUUID();
    this.db.run('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      id,
      input.username,
      input.passwordHash,
      input.role,
      this.now().toISOString(),
    ]);
    const created = this.findById(id);
    if (!created) throw new Error('User vanished after insert.');
    return created;
  }

  /** Changes role/disabled state, refusing to leave the system without an enabled admin. */
  update(id: string, patch: { role?: Role | undefined; disabled?: boolean | undefined }): UserRecord {
    return this.db.transaction(() => {
      const user = this.findById(id);
      if (!user) throw errors.notFound('User');
      const role = patch.role ?? user.role;
      const disabled = patch.disabled ?? user.disabled;
      const losesAdmin = user.role === 'admin' && !user.disabled && (role !== 'admin' || disabled);
      if (losesAdmin && this.enabledAdminCount() <= 1) {
        throw errors.conflict('At least one enabled admin must remain.');
      }
      this.db.run('UPDATE users SET role = ?, disabled = ? WHERE id = ?', [role, disabled ? 1 : 0, id]);
      return { ...user, role, disabled };
    });
  }

  setPassword(id: string, passwordHash: string): void {
    this.db.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [
      passwordHash,
      id,
    ]);
  }

  isLocked(user: UserRecord): boolean {
    return user.lockedUntil !== null && Date.parse(user.lockedUntil) > this.now().getTime();
  }

  recordFailure(user: UserRecord): void {
    const failures = user.failedLogins + 1;
    const lockedUntil =
      failures >= MAX_FAILED_LOGINS ? new Date(this.now().getTime() + LOCKOUT_MS).toISOString() : null;
    this.db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [
      lockedUntil ? 0 : failures,
      lockedUntil,
      user.id,
    ]);
  }

  recordSuccess(user: UserRecord): void {
    this.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [
      this.now().toISOString(),
      user.id,
    ]);
  }

  private enabledAdminCount(): number {
    const sql = "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0";
    return this.db.get<{ n: number }>(sql)?.n ?? 0;
  }
}
