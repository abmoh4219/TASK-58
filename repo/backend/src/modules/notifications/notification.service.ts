import {
  NotificationChannel,
  NotificationScenario,
  NotificationStatus,
  Prisma
} from '../../../prisma/generated';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';

type CreateNotificationInput = {
  actorUserId: string;
  actorRoles: string[];
  userId: string;
  scenario: NotificationScenario;
  channel?: NotificationChannel;
  subject?: string;
  payload?: Prisma.InputJsonValue;
  body?: string;
  destination?: string;
  scheduledFor?: string;
  autoDeliver?: boolean;
  enforceUserScope?: boolean;
};

type DispatchDueInput = {
  actorRoles: string[];
  limit?: number;
};

type HistoryQueryInput = {
  actorUserId: string;
  actorRoles: string[];
  userId?: string;
  scenario?: NotificationScenario;
  status?: NotificationStatus;
  from?: string;
  to?: string;
  limit?: number;
};

type UpdatePreferenceInput = {
  actorUserId: string;
  actorRoles: string[];
  userId?: string;
  globalMuted?: boolean;
  mutedCategories?: NotificationScenario[];
};

function isAdmin(roles: string[]): boolean {
  return roles.includes('ADMIN');
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
  if (!raw) {
    return fallback;
  }

  if (!Number.isInteger(raw) || raw <= 0) {
    throw new AuthError('limit must be a positive integer', 400);
  }

  return Math.min(raw, 500);
}

function ensureUserScope(actorUserId: string, actorRoles: string[], targetUserId: string): void {
  if (targetUserId !== actorUserId && !isAdmin(actorRoles)) {
    throw new AuthError('Not allowed for this user scope', 403);
  }
}

async function getOrCreatePreference(userId: string) {
  const existing = await prisma.userNotificationPreference.findUnique({
    where: {
      userId
    },
    select: {
      id: true,
      userId: true,
      globalMuted: true,
      mutedCategories: true,
      updatedAt: true
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.userNotificationPreference.create({
    data: {
      userId,
      globalMuted: false,
      mutedCategories: []
    },
    select: {
      id: true,
      userId: true,
      globalMuted: true,
      mutedCategories: true,
      updatedAt: true
    }
  });
}

async function shouldMute(userId: string, scenario: NotificationScenario): Promise<boolean> {
  const preference = await getOrCreatePreference(userId);
  if (preference.globalMuted) {
    return true;
  }

  return preference.mutedCategories.includes(scenario);
}

export async function getNotificationPreference(
  actorUserId: string,
  actorRoles: string[],
  targetUserId?: string
) {
  const userId = targetUserId ?? actorUserId;
  ensureUserScope(actorUserId, actorRoles, userId);
  return getOrCreatePreference(userId);
}

export async function updateNotificationPreference(input: UpdatePreferenceInput) {
  const userId = input.userId ?? input.actorUserId;
  ensureUserScope(input.actorUserId, input.actorRoles, userId);

  const current = await getOrCreatePreference(userId);

  return prisma.userNotificationPreference.update({
    where: {
      id: current.id
    },
    data: {
      globalMuted: input.globalMuted ?? current.globalMuted,
      mutedCategories: input.mutedCategories ?? current.mutedCategories
    },
    select: {
      id: true,
      userId: true,
      globalMuted: true,
      mutedCategories: true,
      updatedAt: true
    }
  });
}

async function dispatchNotification(notificationId: string) {
  const now = new Date();

  const notification = await prisma.notification.update({
    where: {
      id: notificationId
    },
    data: {
      status: NotificationStatus.SENT,
      sentAt: now
    },
    select: {
      id: true,
      userId: true,
      scenario: true,
      channel: true,
      status: true,
      subject: true,
      scheduledFor: true,
      sentAt: true,
      createdAt: true
    }
  });

  return notification;
}

export async function createNotification(input: CreateNotificationInput) {
  if (input.enforceUserScope ?? true) {
    ensureUserScope(input.actorUserId, input.actorRoles, input.userId);
  }

  const scheduledFor = parseDate(input.scheduledFor, 'scheduledFor');
  const autoDeliver = input.autoDeliver ?? !scheduledFor;

  const muted = await shouldMute(input.userId, input.scenario);
  const status = muted ? NotificationStatus.CANCELED : NotificationStatus.QUEUED;

  const created = await prisma.notification.create({
    data: {
      userId: input.userId,
      scenario: input.scenario,
      channel: input.channel ?? NotificationChannel.INTERNAL,
      status,
      subject: input.subject ?? null,
      payloadJson: input.payload,
      bodyCiphertext: input.body ?? null,
      bodyIv: null,
      destinationCiphertext: input.destination ?? null,
      destinationIv: null,
      destinationHash: input.destination ? input.destination.toLowerCase() : null,
      scheduledFor,
      failureReason: muted ? 'Muted by user preference' : null
    },
    select: {
      id: true,
      userId: true,
      scenario: true,
      channel: true,
      status: true,
      subject: true,
      scheduledFor: true,
      sentAt: true,
      createdAt: true
    }
  });

  if (autoDeliver && created.status === NotificationStatus.QUEUED) {
    const delivered = await dispatchNotification(created.id);
    return {
      notification: delivered,
      muted: false,
      delivered: true
    };
  }

  return {
    notification: created,
    muted,
    delivered: false
  };
}

export async function dispatchDueNotifications(input: DispatchDueInput) {
  if (!isAdmin(input.actorRoles)) {
    throw new AuthError('Only admins can dispatch due notifications', 403);
  }

  const now = new Date();
  const limit = parseLimit(input.limit, 100);

  const queued = await prisma.notification.findMany({
    where: {
      status: NotificationStatus.QUEUED,
      OR: [
        {
          scheduledFor: null
        },
        {
          scheduledFor: {
            lte: now
          }
        }
      ]
    },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true
    }
  });

  const delivered = [] as Array<{
    id: string;
    userId: string | null;
    scenario: NotificationScenario;
    channel: NotificationChannel;
    status: NotificationStatus;
    subject: string | null;
    scheduledFor: Date | null;
    sentAt: Date | null;
    createdAt: Date;
  }>;

  for (const item of queued) {
    delivered.push(await dispatchNotification(item.id));
  }

  return {
    attempted: queued.length,
    delivered: delivered.length,
    notifications: delivered
  };
}

export async function getNotificationHistory(input: HistoryQueryInput) {
  const userId = input.userId ?? input.actorUserId;
  ensureUserScope(input.actorUserId, input.actorRoles, userId);

  const from = parseDate(input.from, 'from');
  const to = parseDate(input.to, 'to');
  const limit = parseLimit(input.limit, 100);

  if (from && to && to < from) {
    throw new AuthError('to must be after from', 400);
  }

  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      ...(input.scenario ? { scenario: input.scenario } : {}),
      ...(input.status ? { status: input.status } : {}),
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {})
      }
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      userId: true,
      scenario: true,
      channel: true,
      status: true,
      subject: true,
      scheduledFor: true,
      sentAt: true,
      failedAt: true,
      failureReason: true,
      createdAt: true,
      payloadJson: true
    }
  });

  return {
    userId,
    filters: {
      scenario: input.scenario ?? null,
      status: input.status ?? null,
      from: from ?? null,
      to: to ?? null,
      limit
    },
    notifications
  };
}
