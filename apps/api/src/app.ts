import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppContext } from './context';
import { AppError, toErrorBody } from './errors';
import { registerAuth } from './plugins/auth';
import { registerAuthRoutes } from './routes/auth';
import { registerHealth } from './routes/health';
import { registerHosts } from './routes/hosts';
import { registerChecks, registerContainers } from './routes/operations';
import { registerAlerts } from './routes/alerts';
import { registerAdmin } from './routes/admin';

export interface AppOptions {
  /** Milestone route modules register themselves here so app.ts stays a thin composition root. */
  routes?: ((app: FastifyInstance, ctx: AppContext) => void)[];
}

const CLIENT_ERROR_CODES: Record<number, AppError> = {
  413: new AppError('bad_request', 'The request body is too large.'),
  415: new AppError('bad_request', 'Send JSON with Content-Type: application/json.'),
};

function clientError(error: FastifyError): AppError | null {
  const status = error.statusCode;
  if (status === undefined || status < 400 || status >= 500) return null;
  if (status === 429) return new AppError('rate_limited', 'Too many requests. Slow down and retry shortly.');
  return CLIENT_ERROR_CODES[status] ?? new AppError('bad_request', 'The request could not be processed.');
}

function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const known = error instanceof AppError ? error : clientError(error);
    if (known) return reply.code(known.statusCode).send(toErrorBody(known, request.id));
    request.log.error({ err: error }, 'unhandled error');
    const internal = new AppError('internal', 'Something went wrong on the server.');
    return reply.code(500).send(toErrorBody(internal, request.id));
  });
}

async function installStatic(app: FastifyInstance, webDist: string | null): Promise<void> {
  const indexPath = webDist ? join(resolve(webDist), 'index.html') : null;
  const indexHtml = indexPath && existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
  if (webDist && indexHtml) {
    app.get('/', (_request, reply) => reply.header('Cache-Control', 'no-cache').type('text/html').send(indexHtml));
    await app.register(fastifyStatic, {
      root: resolve(webDist),
      index: false,
      dotfiles: 'deny',
      setHeaders(res, path) {
        const immutable = path.includes(`${join(resolve(webDist), 'assets')}`);
        void res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const isPage =
      request.method === 'GET' && !request.url.startsWith('/api/') && request.headers.accept?.includes('text/html');
    if (isPage && indexHtml) return reply.header('Cache-Control', 'no-cache').type('text/html').send(indexHtml);
    const notFound = new AppError('not_found', 'That resource does not exist.');
    return reply.code(404).send(toErrorBody(notFound, request.id));
  });
}

export async function buildApp(ctx: AppContext, options: AppOptions = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
              censor: '[redacted]',
            },
          },
    genReqId: () => randomUUID(),
    trustProxy: config.trustedProxyHops > 0 ? (_address: string, hop: number) => hop < config.trustedProxyHops : false,
    bodyLimit: 64 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    hsts: config.behindTlsProxy ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError('rate_limited', 'Too many requests. Slow down and retry shortly.'),
  });

  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    void reply.header('cache-control', reply.getHeader('cache-control') ?? 'no-store');
    done();
  });

  installErrorHandling(app);
  registerAuth(app, ctx);
  registerHealth(app, ctx);
  registerAuthRoutes(app, ctx);
  registerHosts(app, ctx);
  registerChecks(app, ctx);
  registerContainers(app, ctx);
  registerAlerts(app, ctx);
  registerAdmin(app, ctx);
  for (const register of options.routes ?? []) register(app, ctx);
  await installStatic(app, config.webDist);
  return app;
}
