import type { ComponentState } from '@dockside/shared';
import type { AppConfig } from './config';
import type { Db } from './db/database';
import { AuditService } from './services/audit';
import { SessionService } from './services/sessions';
import { UserService } from './services/users';
import { HostService } from './services/hosts';
import { CheckService } from './services/checks';
import { DockerService } from './services/docker';
import { AlertService } from './services/alerts';

export interface ComponentProbe {
  id: string;
  label: string;
  check: () => { state: ComponentState; detail?: string };
}

/** Everything a route needs. Built once at startup; tests build one against an in-memory database. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  now: () => Date;
  startedAt: Date;
  users: UserService;
  sessions: SessionService;
  audit: AuditService;
  hosts: HostService;
  checks: CheckService;
  docker: DockerService;
  alerts: AlertService;
  /** Modules register a probe for each long-running component so readiness and the status page stay truthful. */
  components: ComponentProbe[];
}

export function createContext(config: AppConfig, db: Db, now: () => Date = () => new Date()): AppContext {
  const users = new UserService(db, now);
  const hosts = new HostService(db, config, now);
  return {
    config,
    db,
    now,
    startedAt: now(),
    users,
    sessions: new SessionService(db, users, now),
    audit: new AuditService(db, now),
    hosts,
    checks: new CheckService(db, now),
    docker: new DockerService(config),
    alerts: new AlertService(db, hosts, config.secretsKey, now),
    components: [
      {
        id: 'database',
        label: 'Database',
        check: () => (db.ping() ? { state: 'ok' } : { state: 'fail', detail: 'SQLite did not answer a ping.' }),
      },
    ],
  };
}
