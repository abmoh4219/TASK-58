import type { FastifyPluginAsync } from 'fastify';
import { NotificationScenario } from '../../../prisma/generated';

import { requireAuth, requireRoles } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';
import { createNotification } from '../notifications/notification.service';
import { publishWebhookEvent } from '../webhooks/webhook.service';
import { prisma } from '../../lib/prisma';

import {
  cancelBooking,
  createBooking,
  getBookingAvailability,
  getWaitlist,
  joinWaitlist,
  previewCancellation,
  promoteNextWaitlisted,
  rescheduleBooking
} from './booking.service';

type CreateBookingBody = {
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

export const bookingRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AvailabilityQuery }>(
    '/availability',
    {
      preHandler: requireAuth
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
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const booking = await createBooking({
          ...request.body,
          userId: request.user.sub,
          userRoles: request.user.roles ?? []
        });

        void createNotification({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: request.user.sub,
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
      preHandler: requireAuth
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
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const result = await getWaitlist(request.query);
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
    '/:bookingId/cancel',
    {
      preHandler: requireAuth
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

  app.get<{ Params: { bookingId: string }; Querystring: CancellationPreviewQuery }>(
    '/:bookingId/cancellation-preview',
    {
      preHandler: requireAuth
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
      preHandler: requireAuth
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
      preHandler: requireAuth
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
      preHandler: requireAuth
    },
    async (request, reply) => {
      try {
        const booking = await prisma.booking.findUnique({
          where: {
            id: request.params.bookingId
          },
          select: {
            id: true,
            userId: true,
            startAt: true,
            endAt: true,
            resourceKey: true
          }
        });

        if (!booking) {
          return reply.code(404).send({ message: 'Booking not found' });
        }

        const remindAt = new Date(request.body.remindAt);
        if (Number.isNaN(remindAt.getTime())) {
          return reply.code(400).send({ message: 'remindAt must be a valid ISO datetime' });
        }

        if (remindAt >= booking.startAt) {
          return reply
            .code(400)
            .send({ message: 'remindAt must be before booking start time' });
        }

        const result = await createNotification({
          actorUserId: request.user.sub,
          actorRoles: request.user.roles ?? [],
          userId: booking.userId,
          scenario: NotificationScenario.CLASS_REMINDER,
          subject: 'Class reminder',
          payload: {
            bookingId: booking.id,
            startAt: booking.startAt,
            endAt: booking.endAt,
            resourceKey: booking.resourceKey
          },
          scheduledFor: remindAt.toISOString(),
          autoDeliver: false
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
