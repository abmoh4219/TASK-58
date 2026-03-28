import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRoles } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';
import { exportAnalyticsCsv } from './analytics-export.service';

import {
  getCompletionAccuracy,
  getDifficultyProgression,
  getCuisineInterestDistribution,
  getRecipeViewVolume,
  getWeeklyConsistencyStreaks,
  trackRecipeView
} from './analytics.service';

type DateRangeQuery = {
  from?: string;
  to?: string;
  limit?: string;
  userId?: string;
};

type TrackViewBody = {
  sessionId?: string;
  viewedAt?: string;
};

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

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { recipeId: string }; Body: TrackViewBody }>(
    '/recipes/:recipeId/views',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const event = await trackRecipeView({
          recipeId: request.params.recipeId,
          actorUserId: request.user.sub,
          sessionId: request.body.sessionId,
          viewedAt: request.body.viewedAt
        });

        return reply.code(201).send({ event });
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.get<{ Querystring: DateRangeQuery }>(
    '/recipes/view-volume',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await getRecipeViewVolume({
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

  app.get<{ Querystring: DateRangeQuery }>(
    '/recipes/cuisine-interest',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await getCuisineInterestDistribution({
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

  app.get<{ Querystring: DateRangeQuery }>(
    '/workflows/weekly-streaks',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await getWeeklyConsistencyStreaks({
          from: request.query.from,
          to: request.query.to,
          userId: request.query.userId
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

  app.get<{ Querystring: DateRangeQuery }>(
    '/workflows/difficulty-progression',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await getDifficultyProgression({
          from: request.query.from,
          to: request.query.to,
          userId: request.query.userId
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

  app.get<{ Querystring: DateRangeQuery }>(
    '/workflows/completion-accuracy',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await getCompletionAccuracy({
          from: request.query.from,
          to: request.query.to,
          userId: request.query.userId
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

  app.get<{ Params: { dataset: string }; Querystring: DateRangeQuery }>(
    '/exports/:dataset.csv',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await exportAnalyticsCsv({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          dataset: request.params.dataset,
          from: request.query.from,
          to: request.query.to,
          userId: request.query.userId,
          requestId: request.id
        });

        reply.header('content-type', result.contentType);
        reply.header('content-disposition', `attachment; filename="${result.fileName}"`);
        return reply.send(result.stream);
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
