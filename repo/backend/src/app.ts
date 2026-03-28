import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

import { AUTH_COOKIE_NAME } from './modules/auth/auth.constants';
import { authRoutes } from './modules/auth/auth.routes';
import { billingRoutes } from './modules/billing/billing.routes';
import { bookingRoutes } from './modules/bookings/booking.routes';
import { notificationRoutes } from './modules/notifications/notification.routes';
import { createIdempotencyMiddleware } from './modules/security/idempotency.middleware';
import { createUserRateLimitMiddleware } from './modules/security/rate-limit.middleware';
import { createSignedRequestMiddleware } from './modules/security/signed-request.middleware';
import { webhookRoutes } from './modules/webhooks/webhook.routes';
import { workflowRoutes } from './modules/workflows/workflow.routes';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cookie, {
    hook: 'onRequest'
  });

  app.register(jwt, {
    secret: process.env.JWT_ACCESS_SECRET || 'development_access_secret',
    cookie: {
      cookieName: AUTH_COOKIE_NAME,
      signed: false
    }
  });

  app.addHook('preHandler', createUserRateLimitMiddleware(app));
  app.addHook('preHandler', createSignedRequestMiddleware());

  const idempotencyMiddleware = createIdempotencyMiddleware();
  app.addHook('preHandler', idempotencyMiddleware.preHandler);
  app.addHook('onSend', idempotencyMiddleware.onSend);

  app.register(authRoutes, { prefix: '/auth' });
  app.register(billingRoutes, { prefix: '/billing' });
  app.register(bookingRoutes, { prefix: '/bookings' });
  app.register(notificationRoutes, { prefix: '/notifications' });
  app.register(webhookRoutes, { prefix: '/webhooks' });
  app.register(workflowRoutes, { prefix: '/workflows' });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
