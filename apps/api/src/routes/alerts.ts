import { ChannelInputSchema, RuleInputSchema } from '@dockside/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parseWith } from '../errors';
import { requirePermission } from '../plugins/auth';
import { audited, beforeId, idOf } from './helpers';

export function registerAlerts(app: FastifyInstance, ctx: AppContext): void {
  const read = { preHandler: requirePermission(ctx, 'alerts:read') };
  const manage = { preHandler: requirePermission(ctx, 'alerts:manage') };
  app.get('/api/v1/alerts/rules', read, () => ctx.alerts.list());
  app.get('/api/v1/alerts/events', read, (req) => ctx.alerts.events(beforeId(req)));
  app.post('/api/v1/alerts/rules', manage, (req, reply) =>
    audited(ctx, req, 'alert.create', () => {
      const result = ctx.alerts.create(parseWith(RuleInputSchema, req.body));
      void reply.code(201);
      return result;
    }),
  );
  app.patch('/api/v1/alerts/rules/:id', manage, (req) =>
    audited(ctx, req, 'alert.update', () => ctx.alerts.update(idOf(req), parseWith(RuleInputSchema, req.body))),
  );
  app.delete('/api/v1/alerts/rules/:id', manage, (req, reply) =>
    audited(ctx, req, 'alert.delete', () => {
      ctx.alerts.delete(idOf(req));
      return reply.code(204).send();
    }),
  );
  app.post(
    '/api/v1/alerts/rules/:id/acknowledge',
    { preHandler: requirePermission(ctx, 'alerts:acknowledge') },
    (req) => audited(ctx, req, 'alert.acknowledge', () => ctx.alerts.act(idOf(req), 'acknowledge')),
  );
  app.post('/api/v1/alerts/rules/:id/silence', { preHandler: requirePermission(ctx, 'alerts:silence') }, (req) =>
    audited(ctx, req, 'alert.silence', () => {
      const body = parseWith(z.object({ seconds: z.number().int().min(60).max(604800) }), req.body);
      return ctx.alerts.act(idOf(req), 'silence', body.seconds);
    }),
  );
  registerChannels(app, ctx);
}

function registerChannels(app: FastifyInstance, ctx: AppContext): void {
  const manage = { preHandler: requirePermission(ctx, 'alerts:manage') };
  app.get('/api/v1/alerts/channels', manage, () => ctx.alerts.channels());
  app.post('/api/v1/alerts/channels', manage, (req, reply) =>
    audited(ctx, req, 'channel.create', () => {
      void reply.code(201);
      return ctx.alerts.saveChannel(parseWith(ChannelInputSchema, req.body));
    }),
  );
  app.delete('/api/v1/alerts/channels/:id', manage, (req, reply) =>
    audited(ctx, req, 'channel.delete', () => {
      ctx.alerts.deleteChannel(idOf(req));
      return reply.code(204).send();
    }),
  );
}
