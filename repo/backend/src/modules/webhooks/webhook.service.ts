import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  NotificationChannel,
  NotificationScenario,
  NotificationStatus,
  Prisma,
  WebhookDeliveryStatus,
  WebhookFailureAlertStatus,
  WebhookFailureTriggerType,
  WebhookStatus
} from '../../../prisma/generated';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';

type CreateWebhookConfigInput = {
  actorRoles: string[];
  name: string;
  eventKey: string;
  endpoint: string;
  signingSecret: string;
  status?: WebhookStatus;
  timeoutSeconds?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
};

type UpdateWebhookConfigInput = {
  actorRoles: string[];
  configId: string;
  name?: string;
  eventKey?: string;
  endpoint?: string;
  signingSecret?: string;
  status?: WebhookStatus;
  timeoutSeconds?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
};

type PublishWebhookEventInput = {
  eventKey: string;
  payload: Prisma.InputJsonValue;
};

type DispatchDueInput = {
  actorRoles: string[];
  limit?: number;
};

type WebhookLogQueryInput = {
  actorRoles: string[];
  eventKey?: string;
  deliveryStatus?: WebhookDeliveryStatus;
  webhookConfigId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

type WebhookFailureAlertQueryInput = {
  actorRoles: string[];
  status?: WebhookFailureAlertStatus;
  webhookConfigId?: string;
  eventKey?: string;
  from?: string;
  to?: string;
  limit?: number;
};

type AcknowledgeFailureAlertInput = {
  actorUserId: string;
  actorRoles: string[];
  alertId: string;
};

function isAdmin(roles: string[]): boolean {
  return roles.includes('ADMIN');
}

function ensureAdmin(roles: string[]): void {
  if (!isAdmin(roles)) {
    throw new AuthError('Admin role required', 403);
  }
}

function parsePositiveInt(raw: number | undefined, fallback: number, name: string): number {
  if (raw === undefined) {
    return fallback;
  }

  if (!Number.isInteger(raw) || raw <= 0) {
    throw new AuthError(`${name} must be a positive integer`, 400);
  }

  return raw;
}

function parseDate(raw: string | undefined, name: string): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new AuthError(`${name} must be a valid ISO datetime`, 400);
  }

  return value;
}

function parseLimit(raw: number | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }

  if (!Number.isInteger(raw) || raw <= 0) {
    throw new AuthError('limit must be a positive integer', 400);
  }

  return Math.min(raw, 500);
}

function endpointHash(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex');
}

function normalizeEventKey(raw: string): string {
  const key = raw.trim();
  if (!key || key.length > 80) {
    throw new AuthError('eventKey must be 1..80 chars', 400);
  }

  return key;
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 120) {
    throw new AuthError('name must be 1..120 chars', 400);
  }

  return name;
}

function allowLocalTargets(): boolean {
  const raw = process.env.WEBHOOK_ALLOW_LOCAL_TARGETS;
  if (!raw) {
    return process.env.NODE_ENV !== 'production';
  }

  return raw === 'true';
}

function isLocalHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  if (hostname === 'host.docker.internal') {
    return true;
  }

  return hostname.endsWith('.local');
}

function validateEndpoint(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AuthError('endpoint must be a valid URL', 400);
  }

  const local = isLocalHostname(parsed.hostname);

  if (!local && parsed.protocol !== 'https:') {
    throw new AuthError('non-local webhook endpoints must use https', 400);
  }

  if (local && !allowLocalTargets()) {
    throw new AuthError('local webhook targets are disabled', 400);
  }

  return parsed.toString();
}

function normalizeSecret(raw: string): string {
  const value = raw.trim();
  if (value.length < 16) {
    throw new AuthError('signingSecret must be at least 16 characters', 400);
  }

  return value;
}

function nextBackoffDelaySeconds(attemptNumber: number): number {
  const base = Number(process.env.WEBHOOK_RETRY_BASE_SECONDS || 5);
  const cap = Number(process.env.WEBHOOK_RETRY_MAX_SECONDS || 300);

  const safeBase = Number.isFinite(base) && base > 0 ? base : 5;
  const safeCap = Number.isFinite(cap) && cap > 0 ? cap : 300;

  const raw = safeBase * 2 ** Math.max(attemptNumber - 1, 0);
  return Math.min(Math.floor(raw), Math.floor(safeCap));
}

function failureAlertThresholdAttempts(): number {
  const raw = Number(process.env.WEBHOOK_FAILURE_ALERT_THRESHOLD_ATTEMPTS || 3);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 3;
  }

  return Math.floor(raw);
}

function canonicalPayloadString(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

function signatureForPayload(secret: string, timestampSeconds: number, body: string): string {
  const canonical = canonicalPayloadString(timestampSeconds, body);
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

async function createAdminFailureNotifications(
  alertId: string,
  eventKey: string,
  triggerType: WebhookFailureTriggerType,
  webhookConfigId: string,
  message: string | null
): Promise<void> {
  const admins = await prisma.userRole.findMany({
    where: {
      role: {
        code: 'ADMIN'
      }
    },
    select: {
      userId: true
    }
  });

  if (admins.length === 0) {
    return;
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const admin of admins) {
      await tx.notification.create({
        data: {
          userId: admin.userId,
          scenario: NotificationScenario.WEBHOOK_FAILURE,
          channel: NotificationChannel.INTERNAL,
          status: NotificationStatus.SENT,
          subject: 'Webhook delivery failure alert',
          payloadJson: {
            alertId,
            eventKey,
            triggerType,
            webhookConfigId,
            message
          },
          sentAt: now
        }
      });
    }
  });
}

async function upsertFailureAlert(input: {
  webhookConfigId: string;
  webhookLogId: string;
  eventKey: string;
  triggerType: WebhookFailureTriggerType;
  errorMessage: string | null;
  occurredAt: Date;
}): Promise<void> {
  const existing = await prisma.webhookFailureAlert.findFirst({
    where: {
      webhookConfigId: input.webhookConfigId,
      eventKey: input.eventKey,
      status: WebhookFailureAlertStatus.OPEN
    },
    orderBy: {
      updatedAt: 'desc'
    },
    select: {
      id: true,
      failureCount: true
    }
  });

  if (existing) {
    await prisma.webhookFailureAlert.update({
      where: {
        id: existing.id
      },
      data: {
        latestWebhookLogId: input.webhookLogId,
        triggerType: input.triggerType,
        failureCount: existing.failureCount + 1,
        lastFailedAt: input.occurredAt,
        lastErrorMessage: input.errorMessage
      }
    });
    return;
  }

  const created = await prisma.webhookFailureAlert.create({
    data: {
      webhookConfigId: input.webhookConfigId,
      latestWebhookLogId: input.webhookLogId,
      eventKey: input.eventKey,
      triggerType: input.triggerType,
      failureCount: 1,
      firstFailedAt: input.occurredAt,
      lastFailedAt: input.occurredAt,
      lastErrorMessage: input.errorMessage,
      status: WebhookFailureAlertStatus.OPEN
    },
    select: {
      id: true
    }
  });

  await createAdminFailureNotifications(
    created.id,
    input.eventKey,
    input.triggerType,
    input.webhookConfigId,
    input.errorMessage
  );
}

export async function createWebhookConfig(input: CreateWebhookConfigInput) {
  ensureAdmin(input.actorRoles);

  const config = await prisma.webhookConfig.create({
    data: {
      name: normalizeName(input.name),
      eventKey: normalizeEventKey(input.eventKey),
      status: input.status ?? WebhookStatus.ACTIVE,
      endpointCiphertext: validateEndpoint(input.endpoint),
      endpointHash: endpointHash(input.endpoint),
      endpointIv: null,
      signingSecretCiphertext: normalizeSecret(input.signingSecret),
      signingSecretIv: null,
      timeoutSeconds: parsePositiveInt(input.timeoutSeconds, 10, 'timeoutSeconds'),
      maxRetries: parsePositiveInt(input.maxRetries, 5, 'maxRetries'),
      headersJson: input.headers
    },
    select: {
      id: true,
      name: true,
      eventKey: true,
      status: true,
      endpointHash: true,
      timeoutSeconds: true,
      maxRetries: true,
      headersJson: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return config;
}

export async function updateWebhookConfig(input: UpdateWebhookConfigInput) {
  ensureAdmin(input.actorRoles);

  const existing = await prisma.webhookConfig.findUnique({
    where: { id: input.configId },
    select: { id: true }
  });

  if (!existing) {
    throw new AuthError('Webhook config not found', 404);
  }

  const updated = await prisma.webhookConfig.update({
    where: { id: input.configId },
    data: {
      ...(input.name !== undefined ? { name: normalizeName(input.name) } : {}),
      ...(input.eventKey !== undefined ? { eventKey: normalizeEventKey(input.eventKey) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.endpoint !== undefined
        ? {
            endpointCiphertext: validateEndpoint(input.endpoint),
            endpointHash: endpointHash(input.endpoint),
            endpointIv: null
          }
        : {}),
      ...(input.signingSecret !== undefined
        ? {
            signingSecretCiphertext: normalizeSecret(input.signingSecret),
            signingSecretIv: null
          }
        : {}),
      ...(input.timeoutSeconds !== undefined
        ? { timeoutSeconds: parsePositiveInt(input.timeoutSeconds, 10, 'timeoutSeconds') }
        : {}),
      ...(input.maxRetries !== undefined
        ? { maxRetries: parsePositiveInt(input.maxRetries, 5, 'maxRetries') }
        : {}),
      ...(input.headers !== undefined ? { headersJson: input.headers } : {})
    },
    select: {
      id: true,
      name: true,
      eventKey: true,
      status: true,
      endpointHash: true,
      timeoutSeconds: true,
      maxRetries: true,
      headersJson: true,
      updatedAt: true
    }
  });

  return updated;
}

export async function listWebhookConfigs(actorRoles: string[]) {
  ensureAdmin(actorRoles);

  return prisma.webhookConfig.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      eventKey: true,
      status: true,
      endpointHash: true,
      timeoutSeconds: true,
      maxRetries: true,
      headersJson: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

export async function publishWebhookEvent(input: PublishWebhookEventInput) {
  const eventKey = normalizeEventKey(input.eventKey);

  const configs = await prisma.webhookConfig.findMany({
    where: {
      eventKey,
      status: WebhookStatus.ACTIVE
    },
    select: {
      id: true
    }
  });

  if (configs.length === 0) {
    return {
      eventKey,
      queued: 0
    };
  }

  const now = new Date();
  const eventEnvelope = {
    eventId: randomUUID(),
    eventKey,
    occurredAt: now.toISOString(),
    payload: input.payload
  };
  const requestBody = JSON.stringify(eventEnvelope);

  await prisma.$transaction(async (tx) => {
    for (const config of configs) {
      await tx.webhookLog.create({
        data: {
          webhookConfigId: config.id,
          eventKey,
          attemptNumber: 1,
          deliveryStatus: WebhookDeliveryStatus.PENDING,
          requestBodyCiphertext: requestBody,
          requestBodyIv: null,
          requestedAt: now
        }
      });
    }
  });

  return {
    eventKey,
    queued: configs.length
  };
}

async function postWebhook(logId: string): Promise<void> {
  const log = await prisma.webhookLog.findUnique({
    where: {
      id: logId
    },
    select: {
      id: true,
      webhookConfigId: true,
      eventKey: true,
      attemptNumber: true,
      requestBodyCiphertext: true,
      requestedAt: true,
      webhookConfig: {
        select: {
          id: true,
          status: true,
          endpointCiphertext: true,
          signingSecretCiphertext: true,
          timeoutSeconds: true,
          maxRetries: true,
          headersJson: true
        }
      }
    }
  });

  if (!log) {
    return;
  }

  if (log.webhookConfig.status !== WebhookStatus.ACTIVE) {
    const now = new Date();
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        deliveryStatus: WebhookDeliveryStatus.DEAD_LETTER,
        errorMessage: 'Webhook config inactive',
        respondedAt: now
      }
    });

    await upsertFailureAlert({
      webhookConfigId: log.webhookConfigId,
      webhookLogId: log.id,
      eventKey: log.eventKey,
      triggerType: WebhookFailureTriggerType.DEAD_LETTER,
      errorMessage: 'Webhook config inactive',
      occurredAt: now
    });
    return;
  }

  const endpoint = log.webhookConfig.endpointCiphertext;
  const secret = log.webhookConfig.signingSecretCiphertext || '';
  const body = log.requestBodyCiphertext || '{}';

  if (!secret) {
    const now = new Date();
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        deliveryStatus: WebhookDeliveryStatus.DEAD_LETTER,
        errorMessage: 'Missing webhook signing secret',
        respondedAt: now
      }
    });

    await upsertFailureAlert({
      webhookConfigId: log.webhookConfigId,
      webhookLogId: log.id,
      eventKey: log.eventKey,
      triggerType: WebhookFailureTriggerType.DEAD_LETTER,
      errorMessage: 'Missing webhook signing secret',
      occurredAt: now
    });
    return;
  }

  const timestampSeconds = Math.floor(Date.now() / 1000);
  const signature = signatureForPayload(secret, timestampSeconds, body);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-webhook-id': log.id,
    'x-webhook-event': log.eventKey,
    'x-webhook-timestamp': String(timestampSeconds),
    'x-webhook-signature': `sha256=${signature}`,
    'x-webhook-signature-version': 'v1',
    'x-webhook-key-id': log.webhookConfig.id
  };

  // Receiver-side clock/skew note:
  // `x-webhook-timestamp` is unix-seconds and signed as `${timestamp}.${body}`.
  // Subscribers should verify HMAC and reject stale timestamps outside their acceptable skew window.
  const customHeaders = (log.webhookConfig.headersJson || {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(customHeaders)) {
    if (typeof value === 'string') {
      headers[key.toLowerCase()] = value;
    }
  }

  const timeoutMs = Math.max(log.webhookConfig.timeoutSeconds, 1) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let responseStatusCode: number | null = null;
  let responseBody: string | null = null;
  let responseHeadersJson: Prisma.InputJsonValue | undefined;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });

    responseStatusCode = response.status;
    responseBody = await response.text();
    responseHeadersJson = Object.fromEntries(response.headers.entries());
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Network error';
  } finally {
    clearTimeout(timer);
  }

  const now = new Date();
  const transientFailure =
    errorMessage !== null ||
    responseStatusCode === null ||
    responseStatusCode === 408 ||
    responseStatusCode === 429 ||
    responseStatusCode >= 500;

  if (!transientFailure && responseStatusCode && responseStatusCode >= 200 && responseStatusCode < 300) {
    await prisma.webhookLog.update({
      where: {
        id: log.id
      },
      data: {
        deliveryStatus: WebhookDeliveryStatus.SUCCESS,
        responseStatusCode,
        responseHeadersJson,
        responseBodyCiphertext: responseBody,
        responseBodyIv: null,
        respondedAt: now,
        errorMessage: null
      }
    });
    return;
  }

  const maxRetries = Math.max(log.webhookConfig.maxRetries, 0);
  const reachedMax = log.attemptNumber >= maxRetries;
  const permanentFailure = !transientFailure && responseStatusCode !== null && responseStatusCode >= 400;

  if (permanentFailure || reachedMax) {
    const failureMessage =
      errorMessage ||
      (permanentFailure
        ? `Permanent HTTP failure: ${responseStatusCode}`
        : 'Max retry attempts reached');

    await prisma.webhookLog.update({
      where: {
        id: log.id
      },
      data: {
        deliveryStatus: WebhookDeliveryStatus.DEAD_LETTER,
        responseStatusCode,
        responseHeadersJson,
        responseBodyCiphertext: responseBody,
        responseBodyIv: null,
        respondedAt: now,
        errorMessage: failureMessage
      }
    });

    await upsertFailureAlert({
      webhookConfigId: log.webhookConfigId,
      webhookLogId: log.id,
      eventKey: log.eventKey,
      triggerType: WebhookFailureTriggerType.DEAD_LETTER,
      errorMessage: failureMessage,
      occurredAt: now
    });
    return;
  }

  const nextAttemptNumber = log.attemptNumber + 1;
  const delaySeconds = nextBackoffDelaySeconds(log.attemptNumber);
  const nextRequestedAt = new Date(now.getTime() + delaySeconds * 1000);

  await prisma.webhookLog.update({
    where: {
      id: log.id
    },
    data: {
      deliveryStatus: WebhookDeliveryStatus.PENDING,
      attemptNumber: nextAttemptNumber,
      requestedAt: nextRequestedAt,
      responseStatusCode,
      responseHeadersJson,
      responseBodyCiphertext: responseBody,
      responseBodyIv: null,
      respondedAt: now,
      errorMessage: errorMessage || (responseStatusCode ? `Retryable HTTP ${responseStatusCode}` : 'Retryable failure')
    }
  });

  if (nextAttemptNumber >= failureAlertThresholdAttempts()) {
    await upsertFailureAlert({
      webhookConfigId: log.webhookConfigId,
      webhookLogId: log.id,
      eventKey: log.eventKey,
      triggerType: WebhookFailureTriggerType.RETRY_THRESHOLD,
      errorMessage: errorMessage || (responseStatusCode ? `Retryable HTTP ${responseStatusCode}` : 'Retryable failure'),
      occurredAt: now
    });
  }
}

export async function dispatchDueWebhookLogs(input: DispatchDueInput) {
  ensureAdmin(input.actorRoles);

  const now = new Date();
  const limit = parseLimit(input.limit, 50);

  const due = await prisma.webhookLog.findMany({
    where: {
      deliveryStatus: WebhookDeliveryStatus.PENDING,
      requestedAt: {
        lte: now
      }
    },
    orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true
    }
  });

  for (const item of due) {
    await postWebhook(item.id);
  }

  const summary = await prisma.webhookLog.groupBy({
    by: ['deliveryStatus'],
    _count: {
      _all: true
    },
    where: {
      id: {
        in: due.map((item) => item.id)
      }
    }
  });

  return {
    attempted: due.length,
    summary
  };
}

export async function queryWebhookLogs(input: WebhookLogQueryInput) {
  ensureAdmin(input.actorRoles);

  const from = parseDate(input.from, 'from');
  const to = parseDate(input.to, 'to');
  if (from && to && to < from) {
    throw new AuthError('to must be after from', 400);
  }

  const limit = parseLimit(input.limit, 200);

  const logs = await prisma.webhookLog.findMany({
    where: {
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
      ...(input.deliveryStatus ? { deliveryStatus: input.deliveryStatus } : {}),
      ...(input.webhookConfigId ? { webhookConfigId: input.webhookConfigId } : {}),
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {})
      }
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      webhookConfigId: true,
      eventKey: true,
      attemptNumber: true,
      deliveryStatus: true,
      responseStatusCode: true,
      errorMessage: true,
      requestedAt: true,
      respondedAt: true,
      createdAt: true
    }
  });

  return {
    filters: {
      eventKey: input.eventKey ?? null,
      deliveryStatus: input.deliveryStatus ?? null,
      webhookConfigId: input.webhookConfigId ?? null,
      from: from ?? null,
      to: to ?? null,
      limit
    },
    logs
  };
}

export async function queryWebhookFailureAlerts(input: WebhookFailureAlertQueryInput) {
  ensureAdmin(input.actorRoles);

  const from = parseDate(input.from, 'from');
  const to = parseDate(input.to, 'to');
  if (from && to && to < from) {
    throw new AuthError('to must be after from', 400);
  }

  const limit = parseLimit(input.limit, 200);

  const alerts = await prisma.webhookFailureAlert.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.webhookConfigId ? { webhookConfigId: input.webhookConfigId } : {}),
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {})
      }
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      webhookConfigId: true,
      latestWebhookLogId: true,
      eventKey: true,
      status: true,
      triggerType: true,
      failureCount: true,
      firstFailedAt: true,
      lastFailedAt: true,
      lastErrorMessage: true,
      acknowledgedByUserId: true,
      acknowledgedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return {
    filters: {
      status: input.status ?? null,
      webhookConfigId: input.webhookConfigId ?? null,
      eventKey: input.eventKey ?? null,
      from: from ?? null,
      to: to ?? null,
      limit
    },
    alerts
  };
}

export async function acknowledgeWebhookFailureAlert(input: AcknowledgeFailureAlertInput) {
  ensureAdmin(input.actorRoles);

  const existing = await prisma.webhookFailureAlert.findUnique({
    where: {
      id: input.alertId
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!existing) {
    throw new AuthError('Webhook failure alert not found', 404);
  }

  if (existing.status === WebhookFailureAlertStatus.ACKNOWLEDGED) {
    return prisma.webhookFailureAlert.findUnique({
      where: { id: existing.id },
      select: {
        id: true,
        status: true,
        acknowledgedByUserId: true,
        acknowledgedAt: true,
        updatedAt: true
      }
    });
  }

  return prisma.webhookFailureAlert.update({
    where: {
      id: existing.id
    },
    data: {
      status: WebhookFailureAlertStatus.ACKNOWLEDGED,
      acknowledgedByUserId: input.actorUserId,
      acknowledgedAt: new Date()
    },
    select: {
      id: true,
      status: true,
      acknowledgedByUserId: true,
      acknowledgedAt: true,
      updatedAt: true
    }
  });
}
