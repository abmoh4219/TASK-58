import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';

import {
  createWorkflowRun,
  getActiveWorkflowRuns,
  getWorkflowRunEvents,
  getWorkflowRunState,
  pauseWorkflowRun,
  resumeWorkflowRun,
  rollbackWorkflowStep,
  completeWorkflowStep,
  skipWorkflowStep,
  tickWorkflowRun
} from './workflow-run.service';
import { WorkflowRunEventType } from '../../../prisma/generated';
import { materializeWorkflowFromRecipe, parseWorkflowVersionParam } from './workflow-timeline.service';

type TimelineQuery = {
  version?: string;
};

type MaterializeBody = {
  version?: number;
};

type CreateRunBody = {
  recipeId: string;
  bookingId?: string;
  contextJson?: Record<string, unknown>;
};

type StepParams = {
  runId: string;
  runStepId: string;
};

type RollbackBody = {
  reason?: string;
};

type WorkflowEventsQuery = {
  runId?: string;
  userId?: string;
  stepId?: string;
  types?: string;
  from?: string;
  to?: string;
  limit?: string;
};

function parseEventTypes(raw: string | undefined): WorkflowRunEventType[] | undefined {
  if (!raw) {
    return undefined;
  }

  const allowed = new Set(Object.values(WorkflowRunEventType));
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0) as WorkflowRunEventType[];

  for (const item of parsed) {
    if (!allowed.has(item)) {
      throw new AuthError(`Unknown workflow event type: ${item}`, 400);
    }
  }

  return parsed.length > 0 ? parsed : undefined;
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

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { recipeId: string }; Querystring: TimelineQuery }>(
    '/recipes/:recipeId/timeline',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const version = parseWorkflowVersionParam(request.query.version);
        const result = await materializeWorkflowFromRecipe({
          recipeId: request.params.recipeId,
          version
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

  app.post<{ Params: { recipeId: string }; Body: MaterializeBody }>(
    '/recipes/:recipeId/materialize',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await materializeWorkflowFromRecipe({
          recipeId: request.params.recipeId,
          version: request.body.version
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

  app.post<{ Body: CreateRunBody }>(
    '/runs',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await createWorkflowRun({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          recipeId: request.body.recipeId,
          bookingId: request.body.bookingId,
          contextJson: request.body.contextJson
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

  app.get(
    '/runs/active',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await getActiveWorkflowRuns(request.user.sub, request.user.roles ?? []);
        return reply.send({ runs: result });
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.get<{ Params: { runId: string } }>(
    '/runs/:runId',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await getWorkflowRunState(
          request.params.runId,
          request.user.sub,
          request.user.roles ?? []
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

  app.post<{ Params: { runId: string } }>(
    '/runs/:runId/pause',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await pauseWorkflowRun({
          runId: request.params.runId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? []
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

  app.post<{ Params: { runId: string } }>(
    '/runs/:runId/resume',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await resumeWorkflowRun({
          runId: request.params.runId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? []
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

  app.post<{ Params: { runId: string } }>(
    '/runs/:runId/tick',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await tickWorkflowRun({
          runId: request.params.runId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? []
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

  app.post<{ Params: StepParams }>(
    '/runs/:runId/steps/:runStepId/complete',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await completeWorkflowStep({
          runId: request.params.runId,
          runStepId: request.params.runStepId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? []
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

  app.post<{ Params: StepParams }>(
    '/runs/:runId/steps/:runStepId/skip',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await skipWorkflowStep({
          runId: request.params.runId,
          runStepId: request.params.runStepId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? []
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

  app.post<{ Params: StepParams; Body: RollbackBody }>(
    '/runs/:runId/steps/:runStepId/rollback',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await rollbackWorkflowStep({
          runId: request.params.runId,
          runStepId: request.params.runStepId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          reason: request.body.reason
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

  app.get<{ Querystring: WorkflowEventsQuery }>(
    '/events',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await getWorkflowRunEvents({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          runId: request.query.runId,
          userId: request.query.userId,
          stepId: request.query.stepId,
          eventTypes: parseEventTypes(request.query.types),
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
};
