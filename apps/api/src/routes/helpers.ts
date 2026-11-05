import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { AppError, parseWith } from '../errors';
import { requireSession } from '../plugins/auth';

export const idOf = (request: FastifyRequest): string => parseWith(z.object({ id: z.uuid() }), request.params).id;
export const beforeId = (request: FastifyRequest): number =>
  parseWith(
    z.object({
      before: z.coerce.number().int().positive().safe().default(Number.MAX_SAFE_INTEGER),
    }),
    request.query,
  ).before;

export async function audited<T>(
  ctx: AppContext,
  request: FastifyRequest,
  action: string,
  work: () => T | Promise<T>,
): Promise<T> {
  const { user } = requireSession(request);
  const actor = { id: user.id, name: user.username };
  const params = z.object({ id: z.string() }).safeParse(request.params);
  const target = {
    targetType: action.split('.')[0] ?? action,
    ...(params.success ? { targetId: params.data.id } : {}),
  };
  try {
    const result = await work();
    ctx.audit.record({ actor, action, ...target, outcome: 'success', ip: request.ip });
    return result;
  } catch (error) {
    ctx.audit.record({
      actor,
      action,
      ...target,
      outcome: error instanceof AppError && error.statusCode === 403 ? 'denied' : 'failure',
      ip: request.ip,
    });
    throw error;
  }
}
