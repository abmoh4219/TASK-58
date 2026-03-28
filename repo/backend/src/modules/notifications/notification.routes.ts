import type { FastifyPluginAsync } from 'fastify';

import { NotificationChannel, NotificationScenario, NotificationStatus } from '../../../prisma/generated';
import { requireAuth } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';

import {
  createNotification,
  dispatchDueNotifications,
  getNotificationHistory,
  getNotificationPreference,
  updateNotificationPreference
} from './notification.service';

type CreateNotificationBody = {
  userId?: string;
  scenario: NotificationScenario;
  channel?: NotificationChannel;
  subject?: string;
  payload?: Record<string, unknown>;
  body?: string;
  destination?: string;
  scheduledFor?: string;
  autoDeliver?: boolean;
};

type DispatchDueBody = {
  limit?: number;
};

type HistoryQuery = {
  userId?: string;
  scenario?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: string;
};

type PreferenceBody = {
  userId?: string;
  globalMuted?: boolean;
  mutedCategories?: NotificationScenario[];
};

function parseScenario(raw: string | undefined): NotificationScenario | undefined {
  if (!raw) {
    return undefined;
  }

  if (Object.values(NotificationScenario).includes(raw as NotificationScenario)) {
    return raw as NotificationScenario;
  }

  throw new AuthError(`Invalid scenario: ${raw}`, 400);
}

function parseStatus(raw: string | undefined): NotificationStatus | undefined {
  if (!raw) {
    return undefined;
  }

  if (Object.values(NotificationStatus).includes(raw as NotificationStatus)) {
    return raw as NotificationStatus;
  }

  throw new AuthError(`Invalid status: ${raw}`, 400);
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AuthError('limit must be a positive integer', 400);
  }

  return value;
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateNotificationBody }>(
    '/events',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await createNotification({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: request.body.userId ?? request.user.sub,
          scenario: request.body.scenario,
          channel: request.body.channel,
          subject: request.body.subject,
          payload: request.body.payload,
          body: request.body.body,
          destination: request.body.destination,
          scheduledFor: request.body.scheduledFor,
          autoDeliver: request.body.autoDeliver
        });

        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.post<{ Body: DispatchDueBody }>(
    '/dispatch-due',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await dispatchDueNotifications({
          actorRoles: request.user.roles ?? [],
          limit: request.body.limit
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

  app.get<{ Querystring: HistoryQuery }>(
    '/history',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await getNotificationHistory({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: request.query.userId,
          scenario: parseScenario(request.query.scenario),
          status: parseStatus(request.query.status),
          from: request.query.from,
          to: request.query.to,
          limit: parseLimit(request.query.limit)
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

  app.get<{ Querystring: { userId?: string } }>(
    '/preferences',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await getNotificationPreference(
          request.user.sub,
          request.user.roles ?? [],
          request.query.userId
        );

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

  app.put<{ Body: PreferenceBody }>(
    '/preferences',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await updateNotificationPreference({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: request.body.userId,
          globalMuted: request.body.globalMuted,
          mutedCategories: request.body.mutedCategories
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
