import type { FastifyPluginAsync } from 'fastify';

import { WebhookDeliveryStatus, WebhookFailureAlertStatus, WebhookStatus } from '../../../prisma/generated';
import { requireAuth } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';

import {
  acknowledgeWebhookFailureAlert,
  createWebhookConfig,
  dispatchDueWebhookLogs,
  listWebhookConfigs,
  publishWebhookEvent,
  queryWebhookFailureAlerts,
  queryWebhookLogs,
  updateWebhookConfig
} from './webhook.service';

type ConfigBody = {
  name: string;
  eventKey: string;
  endpoint: string;
  signingSecret: string;
  status?: WebhookStatus;
  timeoutSeconds?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
};

type ConfigUpdateBody = Partial<ConfigBody>;

type DispatchBody = {
  limit?: number;
};

type EmitBody = {
  eventKey: string;
  payload: Record<string, unknown>;
};

type LogQuery = {
  eventKey?: string;
  deliveryStatus?: string;
  webhookConfigId?: string;
  from?: string;
  to?: string;
  limit?: string;
};

type FailureAlertQuery = {
  status?: string;
  webhookConfigId?: string;
  eventKey?: string;
  from?: string;
  to?: string;
  limit?: string;
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

function parseDeliveryStatus(raw: string | undefined): WebhookDeliveryStatus | undefined {
  if (!raw) {
    return undefined;
  }

  if (!Object.values(WebhookDeliveryStatus).includes(raw as WebhookDeliveryStatus)) {
    throw new AuthError(`Invalid deliveryStatus: ${raw}`, 400);
  }

  return raw as WebhookDeliveryStatus;
}

function parseFailureAlertStatus(raw: string | undefined): WebhookFailureAlertStatus | undefined {
  if (!raw) {
    return undefined;
  }

  if (!Object.values(WebhookFailureAlertStatus).includes(raw as WebhookFailureAlertStatus)) {
    throw new AuthError(`Invalid alert status: ${raw}`, 400);
  }

  return raw as WebhookFailureAlertStatus;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/configs',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const configs = await listWebhookConfigs(request.user.roles ?? []);
        return reply.send({ configs });
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.post<{ Body: ConfigBody }>(
    '/configs',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const created = await createWebhookConfig({
          actorRoles: request.user.roles ?? [],
          ...request.body
        });

        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.put<{ Params: { configId: string }; Body: ConfigUpdateBody }>(
    '/configs/:configId',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const updated = await updateWebhookConfig({
          actorRoles: request.user.roles ?? [],
          configId: request.params.configId,
          ...request.body
        });

        return reply.send(updated);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.post<{ Body: EmitBody }>(
    '/emit',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await publishWebhookEvent({
          eventKey: request.body.eventKey,
          payload: request.body.payload
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

  app.post<{ Body: DispatchBody }>(
    '/dispatch-due',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await dispatchDueWebhookLogs({
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

  app.get<{ Querystring: LogQuery }>(
    '/logs',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await queryWebhookLogs({
          actorRoles: request.user.roles ?? [],
          eventKey: request.query.eventKey,
          deliveryStatus: parseDeliveryStatus(request.query.deliveryStatus),
          webhookConfigId: request.query.webhookConfigId,
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

  app.get<{ Querystring: FailureAlertQuery }>(
    '/failure-alerts',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await queryWebhookFailureAlerts({
          actorRoles: request.user.roles ?? [],
          status: parseFailureAlertStatus(request.query.status),
          webhookConfigId: request.query.webhookConfigId,
          eventKey: request.query.eventKey,
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

  app.post<{ Params: { alertId: string } }>(
    '/failure-alerts/:alertId/ack',
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await acknowledgeWebhookFailureAlert({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          alertId: request.params.alertId
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
