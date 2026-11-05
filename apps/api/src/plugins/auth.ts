import { can, type Permission } from '@dockside/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context';
import { AppError, errors } from '../errors';
import type { ActiveSession } from '../services/sessions';

declare module 'fastify' {
  interface FastifyRequest {
    auth: ActiveSession | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function cookieName(ctx: AppContext): string {
  return ctx.config.behindTlsProxy ? '__Host-dockside' : 'dockside_sid';
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, sessionId: string, maxAge: number): void {
  void reply.setCookie(cookieName(ctx), sessionId, {
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.config.behindTlsProxy,
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  void reply.clearCookie(cookieName(ctx), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.config.behindTlsProxy,
  });
}

export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', (request, _reply, done) => {
    const sid = request.cookies[cookieName(ctx)];
    request.auth = sid ? ctx.sessions.resolve(sid) : null;
    done();
  });

  // Cookie auth means state-changing requests need a CSRF token (in addition to SameSite=Strict).
  app.addHook('preHandler', (request, _reply, done) => {
    if (!request.auth || SAFE_METHODS.has(request.method)) return done();
    const header = request.headers['x-csrf-token'];
    const supplied = typeof header === 'string' ? header : '';
    if (!safeEqual(supplied, request.auth.csrfToken)) {
      ctx.audit.record({
        actor: { id: request.auth.user.id, name: request.auth.user.username },
        action: 'request.csrf_rejected',
        outcome: 'denied',
        ip: clientIp(request),
        detail: { method: request.method, path: request.routeOptions.url },
      });
      return done(new AppError('csrf_failed', 'The request was missing a valid CSRF token.'));
    }
    return done();
  });
}

/** Route guard: 401 when signed out, 403 (and an audit entry) when the role lacks the permission. */
export function requirePermission(ctx: AppContext, permission: Permission) {
  return (request: FastifyRequest, _reply: FastifyReply, done: (error?: Error) => void): void => {
    if (!request.auth) return done(errors.unauthenticated());
    const { user } = request.auth;
    if (!can(user.role, permission)) {
      ctx.audit.record({
        actor: { id: user.id, name: user.username },
        action: 'request.forbidden',
        outcome: 'denied',
        ip: clientIp(request),
        detail: { permission, method: request.method, path: request.routeOptions.url },
      });
      return done(errors.forbidden());
    }
    return done();
  };
}

export function requireSession(request: FastifyRequest): ActiveSession {
  if (!request.auth) throw errors.unauthenticated();
  return request.auth;
}
