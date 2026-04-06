import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';

import { AuditAction } from '../../../prisma/generated';
import { getConfig } from '../../lib/config';
import { writeAuditLog } from '../audit/audit.service';

import { AUTH_COOKIE_NAME, getAuthCookieOptions } from './auth.constants';
import { requireAuth, requireRoles } from './auth.middleware';
import { AuthError, getUserConsentRecord, loginUser, registerUser, updateUserConsentRecord } from './auth.service';

type RegisterBody = {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  consentGranted: boolean;
};

type LoginBody = {
  username: string;
  password: string;
};

type ConsentUpdateBody = {
  consentGranted: boolean;
};

const registerBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password', 'consentGranted'],
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 50 },
    password: { type: 'string', minLength: 12, maxLength: 200 },
    displayName: { type: 'string', minLength: 1, maxLength: 120 },
    email: { type: 'string', format: 'email', maxLength: 200 },
    consentGranted: { type: 'boolean' }
  }
} as const;

const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 50 },
    password: { type: 'string', minLength: 1, maxLength: 200 }
  }
} as const;

const consentUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['consentGranted'],
  properties: {
    consentGranted: { type: 'boolean' }
  }
} as const;

export const authRoutes: FastifyPluginAsync = async (app) => {
  const config = getConfig();

  app.post<{ Body: RegisterBody }>('/register', {
    schema: {
      body: registerBodySchema
    }
  }, async (request, reply) => {
    try {
      const user = await registerUser(request.body);
      const token = await reply.jwtSign(
        {
          sub: user.id,
          username: user.username,
          roles: user.roles
        },
        {
          expiresIn: config.JWT_ACCESS_EXPIRES_IN
        }
      );

      reply.setCookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
      request.log.info({ module: 'auth', action: 'register', userId: user.id }, 'Registration succeeded');
      return reply.code(201).send({ user });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ message: error.message });
      }

      request.log.error(error);
      return reply.code(500).send({ message: 'Internal server error' });
    }
  });

  app.post<{ Body: LoginBody }>('/login', {
    schema: {
      body: loginBodySchema
    }
  }, async (request, reply) => {
    try {
      const user = await loginUser(request.body);
      const token = await reply.jwtSign(
        {
          sub: user.id,
          username: user.username,
          roles: user.roles
        },
        {
          expiresIn: config.JWT_ACCESS_EXPIRES_IN
        }
      );

      reply.setCookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

      await writeAuditLog({
        actorUserId: user.id,
        action: AuditAction.LOGIN,
        entityType: 'auth_session',
        entityId: user.id,
        entityLabel: user.username,
        requestId: request.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'] as string | undefined,
        afterJson: {
          outcome: 'success'
        }
      });

      request.log.info({ module: 'auth', action: 'login', userId: user.id }, 'Login succeeded');

      return reply.send({ user });
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.statusCode === 401 || error.statusCode === 423) {
          const username = request.body?.username?.trim().toLowerCase() ?? '';

          await writeAuditLog({
            action: AuditAction.MANUAL,
            entityType: 'auth_login',
            entityLabel: username ? createHash('sha256').update(username).digest('hex') : null,
            requestId: request.id,
            ip: request.ip,
            userAgent: request.headers['user-agent'] as string | undefined,
            afterJson: {
              outcome: error.statusCode === 423 ? 'locked' : 'failed',
              statusCode: error.statusCode
            }
          });

          request.log.warn({ module: 'auth', action: 'login', statusCode: error.statusCode }, 'Login denied');
        }

        return reply.code(error.statusCode).send({ message: error.message });
      }

      request.log.error(error);
      return reply.code(500).send({ message: 'Internal server error' });
    }
  });

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, {
      path: '/'
    });

    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const claim = request.user;
    return reply.send({ user: claim });
  });

  app.get(
    '/admin/health',
    {
      preHandler: requireRoles(['ADMIN'])
    },
    async (_request, reply) => {
      return reply.send({ status: 'ok' });
    }
  );

  app.get<{ Params: { userId: string } }>(
    '/admin/users/:userId/consent',
    {
      preHandler: requireRoles(['ADMIN'])
    },
    async (request, reply) => {
      try {
        const result = await getUserConsentRecord(request.user.roles ?? [], request.params.userId);
        return reply.send(result);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.put<{ Params: { userId: string }; Body: ConsentUpdateBody }>(
    '/admin/users/:userId/consent',
    {
      preHandler: requireRoles(['ADMIN']),
      schema: {
        body: consentUpdateBodySchema
      }
    },
    async (request, reply) => {
      try {
        const result = await updateUserConsentRecord({
          actorRoles: request.user.roles ?? [],
          userId: request.params.userId,
          consentGranted: request.body.consentGranted
        });

        return reply.send(result);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );
};
