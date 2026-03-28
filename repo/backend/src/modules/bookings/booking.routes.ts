import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRoles } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.service';

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
