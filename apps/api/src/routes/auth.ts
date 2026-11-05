import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  SetupRequestSchema,
  type FeatureFlags,
  type SessionInfo,
} from '@dockside/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../domain/password';
import { AppError, errors, parseWith } from '../errors';
import { clearSessionCookie, clientIp, cookieName, requireSession, safeEqual, setSessionCookie } from '../plugins/auth';
import { toSummary, type UserRecord } from '../services/users';

const LOGIN_FAILURE = 'Invalid username or password, or the account is temporarily locked.';
const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function featureFlags(ctx: AppContext): FeatureFlags {
  const { config } = ctx;
  return {
    containerActionsEnabled: config.containerActionsEnabled,
    dockerConfigured: config.dockerEndpoint !== null,
    sampleData: config.sampleData,
    rawRetentionDays: config.rawRetentionDays,
    rollupRetentionDays: config.rollupRetentionDays,
    scrapeIntervalSeconds: config.scrapeIntervalSeconds,
    logTailMax: config.logTailMax,
  };
}

function startSession(ctx: AppContext, request: FastifyRequest, reply: FastifyReply, user: UserRecord): SessionInfo {
  const created = ctx.sessions.create(user, {
    ip: clientIp(request),
    userAgent: request.headers['user-agent'] ?? null,
  });
  setSessionCookie(ctx, reply, created.sessionId, created.maxAgeSeconds);
  return { setupRequired: false, user: toSummary(user), csrfToken: created.csrfToken, features: featureFlags(ctx) };
}

async function handleSetup(ctx: AppContext, request: FastifyRequest, reply: FastifyReply): Promise<SessionInfo> {
  const body = parseWith(SetupRequestSchema, request.body);
  if (ctx.users.count() > 0) throw new AppError('setup_closed', 'Setup is already complete.');
  if (!ctx.config.setupToken) {
    throw new AppError('setup_unavailable', 'SETUP_TOKEN is not configured. Run `npm run bootstrap` and restart.');
  }
  if (!safeEqual(body.setupToken, ctx.config.setupToken)) {
    ctx.audit.record({ action: 'setup.rejected', outcome: 'denied', ip: clientIp(request) });
    throw errors.forbidden();
  }
  const passwordHash = await hashPassword(body.password);
  const user = ctx.db.transaction(() => {
    if (ctx.users.count() > 0) throw new AppError('setup_closed', 'Setup is already complete.');
    return ctx.users.create({ username: body.username, passwordHash, role: 'admin' });
  });
  ctx.audit.record({
    actor: { id: user.id, name: user.username },
    action: 'setup.complete',
    targetType: 'user',
    targetId: user.id,
    outcome: 'success',
    ip: clientIp(request),
  });
  return startSession(ctx, request, reply, user);
}

async function handleLogin(ctx: AppContext, request: FastifyRequest, reply: FastifyReply): Promise<SessionInfo> {
  const body = parseWith(LoginRequestSchema, request.body);
  const ip = clientIp(request);
  const user = ctx.users.findByUsername(body.username);
  if (!user) {
    await verifyAgainstDummy(body.password);
    ctx.audit.record({ action: 'login', outcome: 'failure', ip, detail: { reason: 'unknown_user' } });
    throw new AppError('unauthenticated', LOGIN_FAILURE);
  }
  const actor = { id: user.id, name: user.username };
  const locked = ctx.users.isLocked(user);
  const valid = await verifyPassword(body.password, user.passwordHash);
  if (locked || user.disabled || !valid) {
    if (!locked && !user.disabled) ctx.users.recordFailure(user);
    const reason = locked ? 'locked' : user.disabled ? 'disabled' : 'bad_password';
    ctx.audit.record({ actor, action: 'login', outcome: 'failure', ip, detail: { reason } });
    throw new AppError('unauthenticated', LOGIN_FAILURE);
  }
  ctx.users.recordSuccess(user);
  ctx.audit.record({ actor, action: 'login', outcome: 'success', ip });
  return startSession(ctx, request, reply, user);
}

async function handlePasswordChange(ctx: AppContext, request: FastifyRequest): Promise<{ ok: true }> {
  const session = requireSession(request);
  const body = parseWith(ChangePasswordRequestSchema, request.body);
  const { user } = session;
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    ctx.audit.record({ actor: { id: user.id, name: user.username }, action: 'password.change', outcome: 'failure' });
    throw errors.badRequest('Current password is incorrect.');
  }
  ctx.users.setPassword(user.id, await hashPassword(body.newPassword));
  ctx.sessions.destroyAllForUser(user.id, session.idHash);
  ctx.audit.record({
    actor: { id: user.id, name: user.username },
    action: 'password.change',
    targetType: 'user',
    targetId: user.id,
    outcome: 'success',
    ip: clientIp(request),
  });
  return { ok: true };
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/session', (request): SessionInfo => {
    const auth = request.auth;
    return {
      setupRequired: ctx.users.count() === 0,
      user: auth ? toSummary(auth.user) : null,
      csrfToken: auth?.csrfToken ?? null,
      features: auth ? featureFlags(ctx) : null,
    };
  });

  app.post('/api/v1/setup', { config: AUTH_RATE_LIMIT }, (request, reply) => handleSetup(ctx, request, reply));
  app.post('/api/v1/login', { config: AUTH_RATE_LIMIT }, (request, reply) => handleLogin(ctx, request, reply));

  app.post('/api/v1/logout', (request, reply) => {
    const session = requireSession(request);
    ctx.sessions.destroy(request.cookies[cookieName(ctx)] ?? '');
    ctx.audit.record({
      actor: { id: session.user.id, name: session.user.username },
      action: 'logout',
      outcome: 'success',
      ip: clientIp(request),
    });
    clearSessionCookie(ctx, reply);
    return reply.code(204).send();
  });

  app.post('/api/v1/me/password', { config: AUTH_RATE_LIMIT }, (request) => handlePasswordChange(ctx, request));
}
