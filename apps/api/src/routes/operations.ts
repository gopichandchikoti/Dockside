import { CheckInputSchema } from '@dockside/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { errors, parseWith } from '../errors';
import { requirePermission } from '../plugins/auth';
import { audited, idOf } from './helpers';

export function registerChecks(app: FastifyInstance, ctx: AppContext): void {
  const manage = { preHandler: requirePermission(ctx, 'checks:manage') };
  app.get('/api/v1/checks', { preHandler: requirePermission(ctx, 'checks:read') }, () => ctx.checks.list());
  app.post('/api/v1/checks', manage, (req, reply) =>
    audited(ctx, req, 'check.create', () => {
      void reply.code(201);
      return ctx.checks.create(parseWith(CheckInputSchema, req.body));
    }),
  );
  app.delete('/api/v1/checks/:id', manage, (req, reply) =>
    audited(ctx, req, 'check.delete', () => {
      ctx.checks.delete(idOf(req));
      return reply.code(204).send();
    }),
  );
  app.post('/api/v1/checks/:id/run', { preHandler: requirePermission(ctx, 'checks:run') }, (req) =>
    audited(ctx, req, 'check.run', () => ctx.checks.run(idOf(req))),
  );
}

export function registerContainers(app: FastifyInstance, ctx: AppContext): void {
  const containerId = (input: unknown) => parseWith(z.object({ id: z.string().regex(/^[a-f0-9]{12,64}$/) }), input).id;
  app.get('/api/v1/containers', { preHandler: requirePermission(ctx, 'containers:read') }, () => ctx.docker.list());
  app.get('/api/v1/containers/:id/logs', { preHandler: requirePermission(ctx, 'containers:logs') }, (req) => {
    const query = parseWith(
      z.object({
        before: z
          .string()
          .regex(/^\d{1,12}\.\d{9}$/)
          .optional(),
      }),
      req.query,
    );
    return audited(ctx, req, 'container.logs', () => ctx.docker.logs(containerId(req.params), query.before));
  });
  app.post('/api/v1/containers/:id/restart', { preHandler: requirePermission(ctx, 'containers:restart') }, (req) =>
    audited(ctx, req, 'container.restart', async () => {
      if (!ctx.config.containerActionsEnabled) throw errors.disabled('Container restart actions are disabled.');
      parseWith(z.object({ confirm: z.literal(true) }).strict(), req.body);
      await ctx.docker.restart(containerId(req.params));
      return { ok: true };
    }),
  );
}
