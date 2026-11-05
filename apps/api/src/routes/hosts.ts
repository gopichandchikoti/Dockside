import { HostInputSchema, MetricSchema, RangeSchema } from '@dockside/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parseWith } from '../errors';
import { requirePermission } from '../plugins/auth';
import { audited, idOf } from './helpers';

export function registerHosts(app: FastifyInstance, ctx: AppContext): void {
  const read = { preHandler: requirePermission(ctx, 'hosts:read') };
  const manage = { preHandler: requirePermission(ctx, 'hosts:manage') };
  app.get('/api/v1/hosts', read, () => ctx.hosts.list());
  app.get('/api/v1/hosts/:id', read, (req) => ctx.hosts.get(idOf(req)));
  app.get('/api/v1/hosts/:id/metrics', { preHandler: requirePermission(ctx, 'metrics:read') }, (req) => {
    const query = parseWith(z.object({ metric: MetricSchema, range: RangeSchema.default('1h') }), req.query);
    return ctx.hosts.series(idOf(req), query.metric, query.range);
  });
  app.post('/api/v1/hosts', manage, (req, reply) =>
    audited(ctx, req, 'host.create', async () => {
      const host = ctx.hosts.create(parseWith(HostInputSchema, req.body));
      await ctx.hosts.collect(host.id);
      void reply.code(201);
      return ctx.hosts.get(host.id);
    }),
  );
  app.patch('/api/v1/hosts/:id', manage, (req) =>
    audited(ctx, req, 'host.update', () => ctx.hosts.update(idOf(req), parseWith(HostInputSchema, req.body))),
  );
  app.delete('/api/v1/hosts/:id', manage, (req, reply) =>
    audited(ctx, req, 'host.delete', () => {
      ctx.hosts.delete(idOf(req));
      return reply.code(204).send();
    }),
  );
}
