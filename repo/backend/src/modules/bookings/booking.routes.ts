import type { FastifyPluginAsync } from 'fastify';
import { NotificationScenario } from '../../../prisma/generated';

import { requireAuth, requireRoles } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';
import { isAdminRole, isFrontDeskRole, isInstructorRole } from '../auth/roles';
import { createNotification } from '../notifications/notification.service';
import { publishWebhookEvent } from '../webhooks/webhook.service';

import {
  cancelBooking,
  createBooking,
  getBookingAvailability,
  getWaitlist,
  joinWaitlist,
  previewCancellation,
  promoteNextWaitlisted,
  rescheduleBooking,
  scheduleBookingReminder
} from './booking.service';

type CreateBookingBody = {
  userId?: string;
  sessionKey: string;
  seatKey: string;
  startAt: string;
  endAt: string;
  capacity: number;
  partySize?: number;
  invoiceId?: string;
  priceBookId?: string;
  priceBookItemId?: string;
  notes?: string;
};

type AvailabilityQuery = {
  sessionKey: string;
  startAt: string;
  endAt: string;
  capacity: string;
};

type WaitlistJoinBody = {
  sessionKey: string;
  startAt: string;
  endAt: string;
  capacity: number;
  contact?: string;
  notes?: string;
};

type WaitlistQuery = {
  sessionKey: string;
  startAt: string;
  endAt: string;
};

type CancelBookingBody = {
  capacity: number;
  baseAmount?: number;
};

type CancellationPreviewQuery = {
  baseAmount?: string;
};

type RescheduleBody = {
  newSessionKey: string;
  newSeatKey: string;
  newStartAt: string;
  newEndAt: string;
  capacity: number;
};

type PromoteBody = {
  sessionKey: string;
  seatKey: string;
  startAt: string;
  endAt: string;
  capacity: number;
};

type ReminderBody = {
  remindAt: string;
};

const isoDateTime = { type: 'string', format: 'date-time' } as const;

const availabilityQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionKey', 'startAt', 'endAt', 'capacity'],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    sessionKey: { type: 'string', minLength: 1, maxLength: 80 },
    startAt: isoDateTime,
    endAt: isoDateTime,
    capacity: { type: 'string', pattern: '^[1-9]\\d*$' }
  }
} as const;

const createBookingBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionKey', 'seatKey', 'startAt', 'endAt', 'capacity'],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    sessionKey: { type: 'string', minLength: 1, maxLength: 80 },
    seatKey: { type: 'string', minLength: 1, maxLength: 80 },
    startAt: isoDateTime,
    endAt: isoDateTime,
    capacity: { type: 'integer', minimum: 1, maximum: 500 },
    partySize: { type: 'integer', minimum: 1, maximum: 100 },
    invoiceId: { type: 'string', minLength: 1, maxLength: 64 },
    priceBookId: { type: 'string', minLength: 1, maxLength: 64 },
    priceBookItemId: { type: 'string', minLength: 1, maxLength: 64 },
    notes: { type: 'string', maxLength: 2000 }
  }
} as const;

const joinWaitlistBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionKey', 'startAt', 'endAt', 'capacity'],
  properties: {
    sessionKey: { type: 'string', minLength: 1, maxLength: 80 },
    startAt: isoDateTime,
    endAt: isoDateTime,
    capacity: { type: 'integer', minimum: 1, maximum: 500 },
    contact: { type: 'string', maxLength: 200 },
    notes: { type: 'string', maxLength: 2000 }
  }
} as const;

const waitlistQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionKey', 'startAt', 'endAt'],
  properties: {
    sessionKey: { type: 'string', minLength: 1, maxLength: 80 },
    startAt: isoDateTime,
    endAt: isoDateTime
  }
} as const;

const reminderSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['bookingId'],
    properties: {
      bookingId: { type: 'string', minLength: 1, maxLength: 64 }
    }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['remindAt'],
    properties: {
      remindAt: isoDateTime
    }
  }
} as const;

function canViewFullWaitlist(roles: string[]): boolean {
  return isAdminRole(roles) || isFrontDeskRole(roles) || isInstructorRole(roles);
}

export const bookingRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AvailabilityQuery }>(
    '/availability',
    {
      preHandler: requireAuth,
      schema: {
        querystring: availabilityQuerySchema
      }
    },
    async (request, reply) => {
      try {
        const availability = await getBookingAvailability({
          sessionKey: request.query.sessionKey,
          startAt: request.query.startAt,
          endAt: request.query.endAt,
          capacity: Number(request.query.capacity),
          userRoles: request.user.roles ?? []
        });

        return reply.send(availability);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.post<{ Body: CreateBookingBody }>(
    '/',
    {
      preHandler: requireAuth,
      schema: {
        body: createBookingBodySchema
      }
    },
    async (request, reply) => {
      try {
        const booking = await createBooking({
          ...request.body,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userRoles: request.user.roles ?? []
        });

        void createNotification({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: booking.userId,
          scenario: NotificationScenario.BOOKING_SUCCESS,
          subject: 'Booking confirmed',
          payload: {
            bookingId: booking.id,
            sessionKey: booking.sessionKey,
            seatKey: booking.seatKey,
            startAt: booking.startAt,
            endAt: booking.endAt
          },
          autoDeliver: true,
          enforceUserScope: false
        }).catch((err) => request.log.warn({ err }, 'Failed to enqueue booking success notification'));

        void publishWebhookEvent({
          eventKey: 'booking.success',
          payload: {
            bookingId: booking.id,
            userId: booking.userId,
            sessionKey: booking.sessionKey,
            seatKey: booking.seatKey,
            startAt: booking.startAt,
            endAt: booking.endAt
          }
        }).catch((err) => request.log.warn({ err }, 'Failed to enqueue booking success webhook event'));

        return reply.code(201).send({ booking });
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.post<{ Body: WaitlistJoinBody }>(
    '/waitlist',
    {
      preHandler: requireAuth,
      schema: {
        body: joinWaitlistBodySchema
      }
    },
    async (request, reply) => {
      try {
        const result = await joinWaitlist({
          ...request.body,
          userId: request.user.sub,
          userRoles: request.user.roles ?? []
        });

        return reply.code(result.alreadyQueued ? 200 : 201).send(result);
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.get<{ Querystring: WaitlistQuery }>(
    '/waitlist',
    {
      preHandler: requireAuth,
      schema: {
        querystring: waitlistQuerySchema
      }
    },
    async (request, reply) => {
      try {
        const result = await getWaitlist(request.query);
        const actorRoles = request.user.roles ?? [];

        if (canViewFullWaitlist(actorRoles)) {
          return reply.send(result);
        }

        return reply.send({
          ...result,
          entries: result.entries.map((entry) => ({
            ...entry,
            id: entry.userId === request.user.sub ? entry.id : null,
            userId: entry.userId === request.user.sub ? entry.userId : null,
            bookingId: entry.userId === request.user.sub ? entry.bookingId : null
          }))
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.post<{ Params: { bookingId: string }; Body: CancelBookingBody }>(
    '/:bookingId/cancel',
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['bookingId'],
          properties: {
            bookingId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['capacity'],
          properties: {
            capacity: { type: 'integer', minimum: 1, maximum: 500 },
            baseAmount: { type: 'number', minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const result = await previewCancellation({
          bookingId: request.params.bookingId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          baseAmount: request.body.baseAmount
        });

        return reply.send({
          bookingId: result.bookingId,
          feePreview: result.preview,
          requiresConfirmation: true
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        request.log.error(error);
        return reply.code(500).send({ message: 'Internal server error' });
      }
    }
  );

  app.get<{ Params: { bookingId: string }; Querystring: CancellationPreviewQuery }>(
    '/:bookingId/cancellation-preview',
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['bookingId'],
          properties: {
            bookingId: { type: 'string', format: 'uuid' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const baseAmount = request.query.baseAmount !== undefined ? Number(request.query.baseAmount) : undefined;

        const result = await previewCancellation({
          bookingId: request.params.bookingId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          baseAmount
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

  app.post<{ Params: { bookingId: string }; Body: CancelBookingBody }>(
    '/:bookingId/cancel-confirm',
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['bookingId'],
          properties: {
            bookingId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['capacity'],
          properties: {
            capacity: { type: 'integer', minimum: 1, maximum: 500 },
            baseAmount: { type: 'number', minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const result = await cancelBooking({
          bookingId: request.params.bookingId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          capacity: request.body.capacity,
          baseAmount: request.body.baseAmount
        });

        void createNotification({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: request.user.sub,
          scenario: NotificationScenario.CANCELLATION,
          subject: 'Booking canceled',
          payload: {
            bookingId: result.canceledBookingId,
            feePreview: result.feePreview
          },
          autoDeliver: true,
          enforceUserScope: false
        }).catch((err) => request.log.warn({ err }, 'Failed to enqueue cancellation notification'));

        void publishWebhookEvent({
          eventKey: 'booking.cancellation',
          payload: {
            bookingId: result.canceledBookingId,
            feePreview: result.feePreview
          }
        }).catch((err) => request.log.warn({ err }, 'Failed to enqueue cancellation webhook event'));

        if (result.promotion?.promoted && result.promotion.booking?.userId) {
          void createNotification({
            actorUserId: request.user.sub,
            actorRoles: request.user.roles ?? [],
            userId: result.promotion.booking.userId,
            scenario: NotificationScenario.WAITLIST_PROMOTION,
            subject: 'You were promoted from waitlist',
            payload: {
              bookingId: result.promotion.booking.id,
              waitlistEntryId: result.promotion.waitlistEntryId
            },
            autoDeliver: true,
            enforceUserScope: false
          }).catch((err) => request.log.warn({ err }, 'Failed to enqueue waitlist promotion notification'));

          void publishWebhookEvent({
            eventKey: 'waitlist.promotion',
            payload: {
              bookingId: result.promotion.booking.id,
              userId: result.promotion.booking.userId,
              waitlistEntryId: result.promotion.waitlistEntryId
            }
          }).catch((err) => request.log.warn({ err }, 'Failed to enqueue waitlist promotion webhook event'));
        }

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

  app.post<{ Params: { bookingId: string }; Body: RescheduleBody }>(
    '/:bookingId/reschedule',
    {
      preHandler: requireAuth,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['bookingId'],
          properties: {
            bookingId: { type: 'string', format: 'uuid' }
          }
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['newSessionKey', 'newSeatKey', 'newStartAt', 'newEndAt', 'capacity'],
          properties: {
            newSessionKey: { type: 'string', minLength: 1, maxLength: 80 },
            newSeatKey: { type: 'string', minLength: 1, maxLength: 80 },
            newStartAt: { type: 'string', format: 'date-time' },
            newEndAt: { type: 'string', format: 'date-time' },
            capacity: { type: 'integer', minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const result = await rescheduleBooking({
          bookingId: request.params.bookingId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          ...request.body
        });

        void createNotification({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: request.user.sub,
          scenario: NotificationScenario.SCHEDULE_CHANGE,
          subject: 'Booking schedule changed',
          payload: {
            bookingId: result.booking.id,
            sessionKey: result.booking.sessionKey,
            seatKey: result.booking.seatKey,
            startAt: result.booking.startAt,
            endAt: result.booking.endAt
          },
          autoDeliver: true,
          enforceUserScope: false
        }).catch((err) => request.log.warn({ err }, 'Failed to enqueue schedule change notification'));

        void publishWebhookEvent({
          eventKey: 'booking.schedule_change',
          payload: {
            bookingId: result.booking.id,
            userId: result.booking.userId,
            sessionKey: result.booking.sessionKey,
            seatKey: result.booking.seatKey,
            startAt: result.booking.startAt,
            endAt: result.booking.endAt
          }
        }).catch((err) => request.log.warn({ err }, 'Failed to enqueue schedule change webhook event'));

        if (result.oldSlotPromotion?.promoted && result.oldSlotPromotion.booking?.userId) {
          void createNotification({
            actorUserId: request.user.sub,
            actorRoles: request.user.roles ?? [],
            userId: result.oldSlotPromotion.booking.userId,
            scenario: NotificationScenario.WAITLIST_PROMOTION,
            subject: 'You were promoted from waitlist',
            payload: {
              bookingId: result.oldSlotPromotion.booking.id,
              waitlistEntryId: result.oldSlotPromotion.waitlistEntryId
            },
            autoDeliver: true,
            enforceUserScope: false
          }).catch((err) => request.log.warn({ err }, 'Failed to enqueue waitlist promotion notification'));

          void publishWebhookEvent({
            eventKey: 'waitlist.promotion',
            payload: {
              bookingId: result.oldSlotPromotion.booking.id,
              userId: result.oldSlotPromotion.booking.userId,
              waitlistEntryId: result.oldSlotPromotion.waitlistEntryId
            }
          }).catch((err) => request.log.warn({ err }, 'Failed to enqueue waitlist promotion webhook event'));
        }

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

  app.post<{ Body: PromoteBody }>(
    '/promote-next',
    {
      preHandler: [requireAuth, requireRoles(['ADMIN'])]
    },
    async (request, reply) => {
      try {
        const result = await promoteNextWaitlisted({
          ...request.body,
          actorUserId: request.user.sub
        });

        if (result.promoted && result.booking?.userId) {
          void createNotification({
            actorUserId: request.user.sub,
            actorRoles: request.user.roles ?? [],
            userId: result.booking.userId,
            scenario: NotificationScenario.WAITLIST_PROMOTION,
            subject: 'You were promoted from waitlist',
            payload: {
              bookingId: result.booking.id,
              waitlistEntryId: result.waitlistEntryId
            },
            autoDeliver: true,
            enforceUserScope: false
          }).catch((err) => request.log.warn({ err }, 'Failed to enqueue waitlist promotion notification'));

          void publishWebhookEvent({
            eventKey: 'waitlist.promotion',
            payload: {
              bookingId: result.booking.id,
              userId: result.booking.userId,
              waitlistEntryId: result.waitlistEntryId
            }
          }).catch((err) => request.log.warn({ err }, 'Failed to enqueue waitlist promotion webhook event'));
        }

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

  app.post<{ Params: { bookingId: string }; Body: ReminderBody }>(
    '/:bookingId/reminders',
    {
      preHandler: requireAuth,
      schema: reminderSchema
    },
    async (request, reply) => {
      try {
        const result = await scheduleBookingReminder({
          bookingId: request.params.bookingId,
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          remindAt: request.body.remindAt
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
};
