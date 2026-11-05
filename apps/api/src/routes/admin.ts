import { CreateUserRequestSchema, UpdateUserRequestSchema } from '@dockside/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { hashPassword } from '../domain/password';
import { parseWith } from '../errors';
import { requirePermission } from '../plugins/auth';
import { toSummary } from '../services/users';
import { audited, beforeId, idOf } from './helpers';

export function registerAdmin(app: FastifyInstance, ctx: AppContext): void {
  const manage = { preHandler: requirePermission(ctx, 'users:manage') };
  app.get('/api/v1/users', manage, () => ctx.users.list().map(toSummary));
  app.post('/api/v1/users', manage, (req, reply) =>
    audited(ctx, req, 'user.create', async () => {
      const input = parseWith(CreateUserRequestSchema, req.body);
      const user = ctx.users.create({
        username: input.username,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      });
      void reply.code(201);
      return toSummary(user);
    }),
  );
  app.patch('/api/v1/users/:id', manage, (req) =>
    audited(ctx, req, 'user.update', () => {
      const user = ctx.users.update(idOf(req), parseWith(UpdateUserRequestSchema, req.body));
      ctx.sessions.destroyAllForUser(user.id);
      return toSummary(user);
    }),
  );
  app.get('/api/v1/audit', { preHandler: requirePermission(ctx, 'audit:read') }, (req) =>
    ctx.audit.list({ limit: 100, beforeId: beforeId(req) }),
  );
}
