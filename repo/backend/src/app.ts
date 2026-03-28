import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cookie, {
    hook: 'onRequest'
  });

  app.register(jwt, {
    secret: process.env.JWT_ACCESS_SECRET || 'development_access_secret',
    cookie: {
      cookieName: 'access_token',
      signed: false
    }
  });

  return app;
}
