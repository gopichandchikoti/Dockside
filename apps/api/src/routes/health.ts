import { PlatformStatusSchema, type ComponentStatus, type PlatformStatus } from '@dockside/shared';
import { APP_VERSION } from '@dockside/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { MIGRATIONS } from '../db/migrate';
import { requirePermission } from '../plugins/auth';

function componentStatuses(ctx: AppContext): ComponentStatus[] {
  return ctx.components.map((probe) => {
    try {
      const result = probe.check();
      return { id: probe.id, label: probe.label, state: result.state, detail: result.detail ?? null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'probe threw';
      return { id: probe.id, label: probe.label, state: 'fail', detail };
    }
  });
}

export function registerHealth(app: FastifyInstance, ctx: AppContext): void {
  // Liveness: the process is up. Deliberately does no work and reveals nothing.
  app.get('/healthz', { config: { rateLimit: false } }, () => ({ status: 'ok' }));

  // Readiness: dependencies this process needs to serve traffic. Only state names are exposed, never details.
  app.get('/readyz', { config: { rateLimit: false } }, (_request, reply) => {
    const checks = Object.fromEntries(componentStatuses(ctx).map((c) => [c.id, c.state]));
    const failed = Object.values(checks).includes('fail');
    return reply.code(failed ? 503 : 200).send({ status: failed ? 'unready' : 'ready', checks });
  });

  // Rich status for signed-in users (includes human-readable detail).
  app.get('/api/v1/status', { preHandler: requirePermission(ctx, 'settings:read') }, (): PlatformStatus => {
    const body: PlatformStatus = {
      version: APP_VERSION,
      startedAt: ctx.startedAt.toISOString(),
      uptimeSeconds: Math.max(0, Math.round((ctx.now().getTime() - ctx.startedAt.getTime()) / 1000)),
      schemaVersion: Math.max(...MIGRATIONS.map((m) => m.id)),
      components: componentStatuses(ctx),
    };
    return PlatformStatusSchema.parse(body);
  });
}
