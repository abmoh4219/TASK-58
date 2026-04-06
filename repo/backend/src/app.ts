import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import Redis from 'ioredis';

import { getConfig } from './lib/config';
import { normalizeError, normalizeErrorPayload } from './lib/errors';
import { buildLoggerOptions, childRequestLogger } from './lib/logger';
import { prisma } from './lib/prisma';
import { AUTH_COOKIE_NAME } from './modules/auth/auth.constants';
import { resolveApiPrefix } from './modules/api/api-versioning';
import { requireAuth } from './modules/auth/auth.middleware';
import { createAuditOnResponseHook } from './modules/audit/audit.hooks';
import { v1Routes } from './modules/api/v1.routes';
import { createIdempotencyMiddleware } from './modules/security/idempotency.middleware';
import { createUserRateLimitMiddleware } from './modules/security/rate-limit.middleware';
import { createSignedRequestMiddleware } from './modules/security/signed-request.middleware';
import { isProtectedBusinessAction } from './modules/security/security.utils';

export function buildApp() {
  const config = getConfig();
  const app = Fastify({ logger: buildLoggerOptions(), trustProxy: config.TRUST_PROXY });
  const exposeOperationalDetails = config.NODE_ENV === 'development';

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] || '/';
    const module = path.split('/').filter(Boolean)[2] || 'system';
    const action = `${request.method.toUpperCase()} ${path}`;
    (request as any).log = childRequestLogger(request.log, {
      correlationId: request.id,
      module,
      action
    });
  });

  app.addHook('preHandler', async (request) => {
    if (request.user?.sub) {
      (request as any).log = request.log.child({ userId: request.user.sub });
    }
  });

  app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true
  });

  app.register(swagger, {
    stripBasePath: false,
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Culinary Studio API',
        description: 'Versioned backend APIs for operations, billing, workflows, notifications, and analytics.',
        version: '1.0.0'
      },
      servers: [{ url: '/' }],
      tags: [
        { name: 'auth' },
        { name: 'analytics' },
        { name: 'billing' },
        { name: 'bookings' },
        { name: 'notifications' },
        { name: 'webhooks' },
        { name: 'workflows' },
        { name: 'system' }
      ]
    }
  });

  app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiHooks: !exposeOperationalDetails
      ? {
          onRequest: async (request: any, reply: any) => {
            try {
              await request.jwtVerify();
            } catch {
              return reply.code(401).send({ message: 'Unauthorized' });
            }
          }
        }
      : {}
  });

  app.register(cookie, {
    hook: 'onRequest',
    parseOptions: {
      secure: true,
      httpOnly: true,
      sameSite: 'strict'
    }
  });

  app.register(jwt, {
    secret: config.JWT_ACCESS_SECRET,
    cookie: {
      cookieName: AUTH_COOKIE_NAME,
      signed: false
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!isProtectedBusinessAction(request)) {
      return;
    }

    await requireAuth(request, reply);
  });

  app.addHook('preHandler', createUserRateLimitMiddleware(app));
  app.addHook('preHandler', createSignedRequestMiddleware());

  const idempotencyMiddleware = createIdempotencyMiddleware();
  app.addHook('preHandler', idempotencyMiddleware.preHandler);
  app.addHook('onSend', idempotencyMiddleware.onSend);
  app.addHook('onSend', async (_request, reply, payload) => {
    if (reply.statusCode < 400) {
      return payload;
    }

    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        return JSON.stringify(normalizeErrorPayload(parsed, reply.statusCode));
      } catch {
        return payload;
      }
    }

    return normalizeErrorPayload(payload, reply.statusCode);
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      request.log.warn({ err: error }, 'Error occurred after reply already sent');
      return;
    }

    const normalized = normalizeError(error, config.NODE_ENV);
    const level = normalized.statusCode >= 500 ? 'error' : 'warn';
    request.log[level]({ err: error, statusCode: normalized.statusCode }, 'Unhandled request error');
    reply.code(normalized.statusCode).send(normalized.body);
  });

  app.addHook('onResponse', async (request, reply) => {
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
    const isAuthPath = request.url.startsWith('/api/v1/auth/');

    if (reply.statusCode >= 500) {
      request.log.error({ statusCode: reply.statusCode }, 'Request completed with server error');
      return;
    }

    if (reply.statusCode >= 400) {
      request.log.warn({ statusCode: reply.statusCode }, 'Request completed with client error');
      return;
    }

    if (isMutation || isAuthPath) {
      request.log.info({ statusCode: reply.statusCode }, 'Request completed');
    }
  });

  app.addHook('onResponse', createAuditOnResponseHook());

  app.register(v1Routes, { prefix: resolveApiPrefix('v1') });

  app.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Service liveness check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' }
          }
        }
      }
    }
  }, async () => ({ status: 'ok' }));

  app.get('/health/ready', {
    schema: {
      tags: ['system'],
      summary: 'Service readiness check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: { type: 'object' }
          }
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: { type: 'object' }
          }
        }
      }
    }
  }, async (_request, reply) => {
    const checks: Record<string, { ok: boolean; details?: string }> = {
      config: { ok: true }
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch {
      checks.database = { ok: false, details: 'Database connection failed' };
    }

    if (config.REDIS_URL) {
      const redis = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: 0,
        lazyConnect: true
      });

      try {
        await redis.connect();
        await redis.ping();
        checks.redis = { ok: true };
      } catch {
        checks.redis = { ok: false, details: 'Redis connection failed' };
      } finally {
        redis.disconnect();
      }
    } else {
      checks.redis = { ok: true, details: 'Redis not configured' };
    }

    const allReady = Object.values(checks).every((value) => value.ok);
     const status = allReady ? 'ready' : 'not_ready';
     return reply.code(allReady ? 200 : 503).send(
       exposeOperationalDetails
         ? {
             status,
             checks
           }
         : {
             status
           }
     );
   });

  return app;
}
