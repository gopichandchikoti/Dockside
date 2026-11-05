import {
  RuleSchema,
  type AlertEvent,
  type AlertRule,
  type Channel,
  type ChannelInput,
  type RuleInput,
} from '@dockside/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/database';
import { evaluateRule } from '../domain/alerts';
import { decryptSecret, encryptSecret } from '../domain/secrets';
import { errors } from '../errors';
import type { HostService } from './hosts';
import { boundedRequest } from './http';

interface RuleRow {
  id: string;
  host_id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  duration_seconds: number;
  enabled: number;
  state: string;
  pending_since: number | null;
  silenced_until: number | null;
  value: number | null;
}
interface ChannelRow {
  id: string;
  name: string;
  kind: 'webhook' | 'ntfy';
  secret: string;
  last_delivery: string | null;
}
interface EventRow {
  id: number;
  rule_id: string;
  ts: string;
  state: string;
  message: string;
}

export class AlertService {
  private readonly deliveries = new Set<Promise<void>>();
  constructor(
    private readonly db: Db,
    private readonly hosts: HostService,
    private readonly key: string,
    private readonly now: () => Date,
  ) {}
  list(): AlertRule[] {
    return this.db.all<RuleRow>('SELECT * FROM alert_rules ORDER BY name').map((r) =>
      RuleSchema.parse({
        id: r.id,
        hostId: r.host_id,
        name: r.name,
        metric: r.metric,
        operator: r.operator,
        threshold: r.threshold,
        durationSeconds: r.duration_seconds,
        enabled: r.enabled === 1,
        state: r.state,
        pendingSince: r.pending_since,
        silencedUntil: r.silenced_until,
        value: r.value,
      }),
    );
  }
  get(id: string): AlertRule {
    const rule = this.list().find((r) => r.id === id);
    if (!rule) throw errors.notFound('Alert rule');
    return rule;
  }
  create(input: RuleInput): AlertRule {
    this.hosts.get(input.hostId);
    if (this.list().length >= 500) throw errors.conflict('The 500-rule limit has been reached.');
    const id = randomUUID();
    this.db.run(
      `INSERT INTO alert_rules(id, host_id, name, metric, operator, threshold, duration_seconds, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.hostId,
        input.name,
        input.metric,
        input.operator,
        input.threshold,
        input.durationSeconds,
        input.enabled ? 1 : 0,
      ],
    );
    return this.get(id);
  }
  update(id: string, input: RuleInput): AlertRule {
    this.get(id);
    this.hosts.get(input.hostId);
    this.db.run(
      `UPDATE alert_rules SET host_id=?, name=?, metric=?, operator=?, threshold=?, duration_seconds=?,
      enabled=?, state='ok', pending_since=NULL, silenced_until=NULL, value=NULL WHERE id=?`,
      [
        input.hostId,
        input.name,
        input.metric,
        input.operator,
        input.threshold,
        input.durationSeconds,
        input.enabled ? 1 : 0,
        id,
      ],
    );
    return this.get(id);
  }
  delete(id: string): void {
    this.get(id);
    this.db.run('DELETE FROM alert_rules WHERE id=?', [id]);
  }
  evaluate(): void {
    const at = Math.floor(this.now().getTime() / 1000);
    for (const rule of this.list()) {
      const host = this.hosts.get(rule.hostId);
      const value = host.status === 'online' ? (host.latest[rule.metric] ?? null) : null;
      const next = evaluateRule(rule, value, at);
      this.db.transaction(() => {
        this.db.run('UPDATE alert_rules SET state=?, pending_since=?, silenced_until=?, value=? WHERE id=?', [
          next.state,
          next.pendingSince,
          next.silencedUntil,
          next.value,
          rule.id,
        ]);
        if (next.state !== rule.state) this.event(rule, next.state, next.value);
      });
    }
  }
  act(id: string, action: 'acknowledge' | 'silence', seconds = 3600): AlertRule {
    const rule = this.get(id);
    if (action === 'acknowledge' && !['firing', 'acknowledged'].includes(rule.state))
      throw errors.conflict('Only a firing alert can be acknowledged.');
    const state = action === 'silence' ? 'silenced' : 'acknowledged';
    const until = action === 'silence' ? Math.floor(this.now().getTime() / 1000) + seconds : null;
    this.db.transaction(() => {
      this.db.run('UPDATE alert_rules SET state=?, silenced_until=? WHERE id=?', [state, until, id]);
      this.event(rule, state);
    });
    return this.get(id);
  }
  events(before = Number.MAX_SAFE_INTEGER): AlertEvent[] {
    return this.db
      .all<EventRow>('SELECT * FROM alert_events WHERE id<? ORDER BY id DESC LIMIT 100', [before])
      .map((r) => ({ id: r.id, ruleId: r.rule_id, ts: r.ts, state: r.state, message: r.message }));
  }
  channels(): Channel[] {
    return this.db.all<ChannelRow>('SELECT * FROM channels ORDER BY name').map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      url: '[encrypted]',
      token: '[masked]',
      lastDelivery: r.last_delivery,
    }));
  }
  saveChannel(input: ChannelInput, id = randomUUID()): Channel | undefined {
    if (this.channels().length >= 20) throw errors.conflict('The 20-channel limit has been reached.');
    this.db.run('INSERT INTO channels(id, name, kind, secret) VALUES (?, ?, ?, ?)', [
      id,
      input.name,
      input.kind,
      encryptSecret(JSON.stringify({ url: input.url, token: input.token }), this.key),
    ]);
    return this.channels().find((c) => c.id === id);
  }
  deleteChannel(id: string): void {
    if (this.db.run('DELETE FROM channels WHERE id=?', [id]).changes === 0) throw errors.notFound('Channel');
  }
  async idle(): Promise<void> {
    await Promise.allSettled(this.deliveries);
  }
  private event(rule: AlertRule, state: AlertRule['state'], value: number | null = rule.value): void {
    const status = state === 'ok' && value === null ? 'waiting for fresh data' : state;
    const message = `${rule.name}: ${status === 'ok' ? 'recovered' : status}`;
    this.db.run('INSERT INTO alert_events(rule_id, ts, state, message) VALUES (?, ?, ?, ?)', [
      rule.id,
      this.now().toISOString(),
      state,
      message,
    ]);
    if (value === null) return;
    if (state !== 'firing' && !(state === 'ok' && ['firing', 'acknowledged', 'silenced'].includes(rule.state))) return;
    for (const channel of this.db.all<ChannelRow>('SELECT * FROM channels')) this.enqueue(channel, message);
  }
  private enqueue(channel: ChannelRow, message: string): void {
    if (this.deliveries.size >= 20) {
      this.db.run('UPDATE channels SET last_delivery=? WHERE id=?', ['Queue full; notification dropped', channel.id]);
      return;
    }
    const task = this.deliver(channel, message)
      .catch(() => {
        this.db.run('UPDATE channels SET last_delivery=? WHERE id=?', ['Delivery failed after 3 attempts', channel.id]);
      })
      .finally(() => {
        this.deliveries.delete(task);
      });
    this.deliveries.add(task);
  }
  private async deliver(channel: ChannelRow, message: string): Promise<void> {
    const secret = JSON.parse(decryptSecret(channel.secret, this.key)) as { url: string; token: string };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await boundedRequest(secret.url, {
          method: 'POST',
          maxBytes: 64 * 1024,
          headers: {
            'content-type': channel.kind === 'ntfy' ? 'text/plain' : 'application/json',
            ...(secret.token ? { authorization: `Bearer ${secret.token}` } : {}),
          },
          body: channel.kind === 'ntfy' ? message : JSON.stringify({ source: 'Dockside', message }),
        });
        if (response.status < 200 || response.status >= 300) throw new Error('Notification rejected.');
        this.db.run('UPDATE channels SET last_delivery=? WHERE id=?', [
          `Delivered ${this.now().toISOString()}`,
          channel.id,
        ]);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }
}
