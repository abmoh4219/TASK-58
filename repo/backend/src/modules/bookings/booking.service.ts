import { BookingSource, BookingStatus, Prisma, WaitlistStatus } from '../../../prisma/generated';
import { prisma } from '../../lib/prisma';

import { AuthError } from '../auth/auth.service';

type CreateBookingInput = {
  userId: string;
  userRoles: string[];
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
  source?: BookingSource;
};

type AvailabilityInput = {
  sessionKey: string;
  startAt: string;
  endAt: string;
  capacity: number;
  userRoles: string[];
};

type JoinWaitlistInput = {
  userId: string;
  userRoles: string[];
  sessionKey: string;
  startAt: string;
  endAt: string;
  capacity: number;
  contact?: string;
  notes?: string;
};

type CancelBookingInput = {
  bookingId: string;
  actorUserId: string;
  actorRoles: string[];
  capacity: number;
  baseAmount?: number;
};

type CancellationPreviewInput = {
  bookingId: string;
  actorUserId: string;
  actorRoles: string[];
  baseAmount?: number;
};

type RescheduleBookingInput = {
  bookingId: string;
  actorUserId: string;
  actorRoles: string[];
  newSessionKey: string;
  newSeatKey: string;
  newStartAt: string;
  newEndAt: string;
  capacity: number;
};

type PromoteNextInput = {
  actorUserId: string;
  sessionKey: string;
  seatKey: string;
  startAt: string;
  endAt: string;
  capacity: number;
};

type RoleRecord = {
  role: {
    code: string;
  };
};

type BookingCounterClient = Pick<Prisma.TransactionClient, 'booking'>;

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS
];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function nonMemberOpenHours(): number {
  return parsePositiveInt(process.env.BOOKING_OPEN_HOURS_NON_MEMBER, 72);
}

function memberEarlyAccessHours(): number {
  return parsePositiveInt(process.env.BOOKING_MEMBER_EARLY_ACCESS_HOURS, 24);
}

function sanitizeKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) {
    throw new AuthError('Invalid booking key', 400);
  }

  return trimmed;
}

function toDateOrThrow(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AuthError(`Invalid ${name}`, 400);
  }

  return date;
}

function isMember(roles: string[]): boolean {
  return roles.includes('MEMBER');
}

function isAdmin(roles: string[]): boolean {
  return roles.includes('ADMIN');
}

function openingDateForUser(startAt: Date, roles: string[]): Date {
  const base = nonMemberOpenHours();
  const earlyAccess = isMember(roles) ? memberEarlyAccessHours() : 0;
  const totalHours = base + earlyAccess;

  return new Date(startAt.getTime() - totalHours * 60 * 60 * 1000);
}

function bookingResourceKey(sessionKey: string, seatKey: string): string {
  return `${sessionKey}::${seatKey}`;
}

function parseBookingResourceKey(resourceKey: string): { sessionKey: string; seatKey: string } {
  const separator = '::';
  const index = resourceKey.indexOf(separator);

  if (index <= 0 || index >= resourceKey.length - separator.length) {
    throw new AuthError('Stored booking resource key format is invalid', 500);
  }

  return {
    sessionKey: resourceKey.slice(0, index),
    seatKey: resourceKey.slice(index + separator.length)
  };
}

function waitlistScopeResourceKey(sessionKey: string, startAt: Date): string {
  return `${sessionKey}@@${startAt.getTime()}`;
}

function queueDateFromSessionStart(startAt: Date): Date {
  const value = new Date(startAt);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function validateCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new AuthError('capacity must be a positive integer', 400);
  }
}

function parseOptionalNonNegativeAmount(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new AuthError('baseAmount must be a non-negative number', 400);
  }

  return Math.round(value * 100) / 100;
}

function ensureCanManageBooking(actorUserId: string, actorRoles: string[], bookingOwnerUserId: string): void {
  const canManage = actorUserId === bookingOwnerUserId || isAdmin(actorRoles);
  if (!canManage) {
    throw new AuthError('Not allowed to manage this booking', 403);
  }
}

function isBookingActive(status: BookingStatus): boolean {
  return ACTIVE_BOOKING_STATUSES.includes(status);
}

type CancellationFeePreview = {
  policyBand: 'FREE' | 'HALF' | 'FULL';
  feePercent: number;
  feeAmount: number;
  baseAmount: number;
  secondsUntilStart: number;
};

function calculateCancellationFee(startAt: Date, baseAmount: number, now: Date): CancellationFeePreview {
  const secondsUntilStart = Math.floor((startAt.getTime() - now.getTime()) / 1000);

  // Boundary policy:
  // - FREE only when strictly greater than 24h before start.
  // - 50% when <=24h and >=2h before start (exactly 24h and exactly 2h are in this band).
  // - 100% when strictly less than 2h before start.
  if (secondsUntilStart > 24 * 60 * 60) {
    return {
      policyBand: 'FREE',
      feePercent: 0,
      feeAmount: 0,
      baseAmount,
      secondsUntilStart
    };
  }

  if (secondsUntilStart >= 2 * 60 * 60) {
    const feeAmount = Math.round(baseAmount * 0.5 * 100) / 100;
    return {
      policyBand: 'HALF',
      feePercent: 50,
      feeAmount,
      baseAmount,
      secondsUntilStart
    };
  }

  const feeAmount = Math.round(baseAmount * 100) / 100;
  return {
    policyBand: 'FULL',
    feePercent: 100,
    feeAmount,
    baseAmount,
    secondsUntilStart
  };
}

function validateCreateInput(input: CreateBookingInput): {
  sessionKey: string;
  seatKey: string;
  startAt: Date;
  endAt: Date;
  partySize: number;
  capacity: number;
} {
  const sessionKey = sanitizeKey(input.sessionKey);
  const seatKey = sanitizeKey(input.seatKey);
  const startAt = toDateOrThrow(input.startAt, 'startAt');
  const endAt = toDateOrThrow(input.endAt, 'endAt');
  const partySize = input.partySize ?? 1;

  if (!Number.isInteger(partySize) || partySize <= 0) {
    throw new AuthError('partySize must be a positive integer', 400);
  }

  validateCapacity(input.capacity);

  if (endAt <= startAt) {
    throw new AuthError('endAt must be after startAt', 400);
  }

  return {
    sessionKey,
    seatKey,
    startAt,
    endAt,
    partySize,
    capacity: input.capacity
  };
}

function validateAvailabilityInput(input: AvailabilityInput): {
  sessionKey: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
} {
  const sessionKey = sanitizeKey(input.sessionKey);
  const startAt = toDateOrThrow(input.startAt, 'startAt');
  const endAt = toDateOrThrow(input.endAt, 'endAt');

  validateCapacity(input.capacity);

  if (endAt <= startAt) {
    throw new AuthError('endAt must be after startAt', 400);
  }

  return {
    sessionKey,
    startAt,
    endAt,
    capacity: input.capacity
  };
}

function validateWaitlistInput(input: JoinWaitlistInput): {
  sessionKey: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
} {
  const sessionKey = sanitizeKey(input.sessionKey);
  const startAt = toDateOrThrow(input.startAt, 'startAt');
  const endAt = toDateOrThrow(input.endAt, 'endAt');

  validateCapacity(input.capacity);

  if (endAt <= startAt) {
    throw new AuthError('endAt must be after startAt', 400);
  }

  return {
    sessionKey,
    startAt,
    endAt,
    capacity: input.capacity
  };
}

async function activeSessionBookingsCount(
  tx: BookingCounterClient,
  sessionKey: string,
  startAt: Date,
  endAt: Date
): Promise<number> {
  return tx.booking.count({
    where: {
      resourceKey: {
        startsWith: `${sessionKey}::`
      },
      startAt,
      endAt,
      status: {
        in: ACTIVE_BOOKING_STATUSES
      }
    }
  });
}

async function getUserRoleCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const roles = (await tx.userRole.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          code: true
        }
      }
    }
  })) as RoleRecord[];

  return roles.map((entry) => entry.role.code);
}

async function resolveBaseAmount(
  tx: Prisma.TransactionClient,
  input: {
    priceBookItemId?: string | null;
    overrideBaseAmount?: number;
  }
): Promise<number> {
  const override = parseOptionalNonNegativeAmount(input.overrideBaseAmount);
  if (override !== undefined) {
    return override;
  }

  if (!input.priceBookItemId) {
    return 0;
  }

  const item = await tx.priceBookItem.findUnique({
    where: { id: input.priceBookItemId },
    select: {
      unitAmount: true
    }
  });

  return item ? Number(item.unitAmount) : 0;
}

async function createBookingInTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    createdByUserId: string;
    sessionKey: string;
    seatKey: string;
    startAt: Date;
    endAt: Date;
    partySize: number;
    source: BookingSource;
    invoiceId?: string;
    priceBookId?: string;
    priceBookItemId?: string;
    notes?: string;
  }
) {
  return tx.booking.create({
    data: {
      userId: input.userId,
      createdByUserId: input.createdByUserId,
      invoiceId: input.invoiceId,
      priceBookId: input.priceBookId,
      priceBookItemId: input.priceBookItemId,
      resourceKey: bookingResourceKey(input.sessionKey, input.seatKey),
      startAt: input.startAt,
      endAt: input.endAt,
      status: BookingStatus.CONFIRMED,
      source: input.source,
      partySize: input.partySize,
      notesCiphertext: input.notes ?? null,
      notesIv: null
    },
    select: {
      id: true,
      userId: true,
      resourceKey: true,
      startAt: true,
      endAt: true,
      status: true,
      source: true,
      partySize: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

async function promoteNextWaitlistedInTx(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    sessionKey: string;
    seatKey: string;
    startAt: Date;
    endAt: Date;
    capacity: number;
  }
) {
  const sessionWaitlistKey = waitlistScopeResourceKey(input.sessionKey, input.startAt);
  const queueDate = queueDateFromSessionStart(input.startAt);
  const now = new Date();

  const firstWaiting = await tx.waitlist.findFirst({
    where: {
      resourceKey: sessionWaitlistKey,
      desiredStartAt: input.startAt,
      desiredEndAt: input.endAt,
      queueDate,
      status: WaitlistStatus.WAITING
    },
    orderBy: [{ queuePosition: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      userId: true,
      queuePosition: true
    }
  });

  if (!firstWaiting) {
    return {
      promoted: false,
      reason: 'No users in waitlist'
    };
  }

  const userRoles = await getUserRoleCodes(tx, firstWaiting.userId);
  const opensAt = openingDateForUser(input.startAt, userRoles);
  if (now < opensAt) {
    return {
      promoted: false,
      reason: 'Next waitlisted user is not yet eligible by booking window'
    };
  }

  const activeCount = await activeSessionBookingsCount(tx, input.sessionKey, input.startAt, input.endAt);
  if (activeCount >= input.capacity) {
    return {
      promoted: false,
      reason: 'Session still at capacity'
    };
  }

  const overlappingSeatBooking = await tx.booking.findFirst({
    where: {
      resourceKey: bookingResourceKey(input.sessionKey, input.seatKey),
      status: {
        in: ACTIVE_BOOKING_STATUSES
      },
      startAt: {
        lt: input.endAt
      },
      endAt: {
        gt: input.startAt
      }
    },
    select: {
      id: true
    }
  });

  if (overlappingSeatBooking) {
    return {
      promoted: false,
      reason: 'Seat/resource is no longer available'
    };
  }

  const booking = await createBookingInTx(tx, {
    userId: firstWaiting.userId,
    createdByUserId: input.actorUserId,
    sessionKey: input.sessionKey,
    seatKey: input.seatKey,
    startAt: input.startAt,
    endAt: input.endAt,
    partySize: 1,
    source: BookingSource.STAFF,
    notes: `Auto-promoted from waitlist position ${firstWaiting.queuePosition}`
  });

  await tx.waitlist.update({
    where: { id: firstWaiting.id },
    data: {
      status: WaitlistStatus.CONVERTED,
      convertedAt: now,
      offeredAt: now,
      bookingId: booking.id
    }
  });

  return {
    promoted: true,
    waitlistEntryId: firstWaiting.id,
    booking
  };
}

export async function getBookingAvailability(input: AvailabilityInput) {
  const { sessionKey, startAt, endAt, capacity } = validateAvailabilityInput(input);
  const opensAt = openingDateForUser(startAt, input.userRoles);
  const now = new Date();
  const activeCount = await activeSessionBookingsCount(prisma, sessionKey, startAt, endAt);
  const remaining = Math.max(capacity - activeCount, 0);

  return {
    sessionKey,
    startAt,
    endAt,
    opensAt,
    isOpen: now >= opensAt,
    capacity,
    activeBookings: activeCount,
    remainingCapacity: remaining,
    isBookableNow: now >= opensAt && remaining > 0
  };
}

export async function createBooking(input: CreateBookingInput) {
  const { sessionKey, seatKey, startAt, endAt, partySize, capacity } = validateCreateInput(input);

  const opensAt = openingDateForUser(startAt, input.userRoles);
  const now = new Date();
  if (now < opensAt) {
    throw new AuthError('Booking window is not open yet for this user', 403);
  }

  const lockKey = `${sessionKey}|${startAt.toISOString()}|${endAt.toISOString()}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;

    const overlappingSeatBooking = await tx.booking.findFirst({
      where: {
        resourceKey: bookingResourceKey(sessionKey, seatKey),
        status: {
          in: ACTIVE_BOOKING_STATUSES
        },
        startAt: {
          lt: endAt
        },
        endAt: {
          gt: startAt
        }
      },
      select: {
        id: true
      }
    });

    if (overlappingSeatBooking) {
      throw new AuthError('Selected seat/resource is already booked for an overlapping time', 409);
    }

    const activeCount = await activeSessionBookingsCount(tx, sessionKey, startAt, endAt);
    if (activeCount >= capacity) {
      throw new AuthError('Session capacity has been reached', 409);
    }

    try {
      const booking = await createBookingInTx(tx, {
        userId: input.userId,
        createdByUserId: input.userId,
        sessionKey,
        seatKey,
        startAt,
        endAt,
        partySize,
        source: input.source ?? BookingSource.STAFF,
        invoiceId: input.invoiceId,
        priceBookId: input.priceBookId,
        priceBookItemId: input.priceBookItemId,
        notes: input.notes
      });

      return {
        ...booking,
        sessionKey,
        seatKey,
        capacity,
        remainingCapacity: Math.max(capacity - (activeCount + 1), 0)
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2003')
      ) {
        throw new AuthError('Unable to create booking due to a concurrent conflict', 409);
      }

      throw error;
    }
  });
}

export async function joinWaitlist(input: JoinWaitlistInput) {
  const { sessionKey, startAt, endAt, capacity } = validateWaitlistInput(input);

  const opensAt = openingDateForUser(startAt, input.userRoles);
  const now = new Date();
  if (now < opensAt) {
    throw new AuthError('Waitlist is not available yet for this user', 403);
  }

  const lockKey = `${sessionKey}|${startAt.toISOString()}|${endAt.toISOString()}|waitlist`;
  const sessionWaitlistKey = waitlistScopeResourceKey(sessionKey, startAt);
  const queueDate = queueDateFromSessionStart(startAt);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;

    const activeBookings = await activeSessionBookingsCount(tx, sessionKey, startAt, endAt);
    if (activeBookings < capacity) {
      throw new AuthError('Session has available capacity, booking is still possible', 409);
    }

    const existingWaitlist = await tx.waitlist.findFirst({
      where: {
        userId: input.userId,
        resourceKey: sessionWaitlistKey,
        desiredStartAt: startAt,
        desiredEndAt: endAt,
        status: {
          in: [WaitlistStatus.WAITING, WaitlistStatus.OFFERED]
        }
      },
      select: {
        id: true,
        queuePosition: true,
        status: true
      }
    });

    if (existingWaitlist) {
      return {
        alreadyQueued: true,
        waitlistEntry: existingWaitlist
      };
    }

    const entry = await tx.waitlist.create({
      data: {
        userId: input.userId,
        resourceKey: sessionWaitlistKey,
        desiredStartAt: startAt,
        desiredEndAt: endAt,
        queueDate,
        queuePosition: 0,
        status: WaitlistStatus.WAITING,
        contactCiphertext: input.contact ?? null,
        contactIv: null,
        notesCiphertext: input.notes ?? null,
        notesIv: null
      },
      select: {
        id: true,
        userId: true,
        queuePosition: true,
        status: true,
        createdAt: true
      }
    });

    return {
      alreadyQueued: false,
      waitlistEntry: entry
    };
  });
}

export async function getWaitlist(input: { sessionKey: string; startAt: string; endAt: string }) {
  const sessionKey = sanitizeKey(input.sessionKey);
  const startAt = toDateOrThrow(input.startAt, 'startAt');
  const endAt = toDateOrThrow(input.endAt, 'endAt');
  if (endAt <= startAt) {
    throw new AuthError('endAt must be after startAt', 400);
  }

  const sessionWaitlistKey = waitlistScopeResourceKey(sessionKey, startAt);
  const queueDate = queueDateFromSessionStart(startAt);

  const entries = await prisma.waitlist.findMany({
    where: {
      resourceKey: sessionWaitlistKey,
      desiredStartAt: startAt,
      desiredEndAt: endAt,
      queueDate,
      status: {
        in: [WaitlistStatus.WAITING, WaitlistStatus.OFFERED, WaitlistStatus.CONVERTED]
      }
    },
    orderBy: [{ queuePosition: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      userId: true,
      queuePosition: true,
      status: true,
      offeredAt: true,
      convertedAt: true,
      createdAt: true,
      bookingId: true
    }
  });

  return {
    sessionKey,
    startAt,
    endAt,
    entries
  };
}

export async function cancelBooking(input: CancelBookingInput) {
  validateCapacity(input.capacity);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        userId: true,
        resourceKey: true,
        startAt: true,
        endAt: true,
        status: true,
        priceBookItemId: true
      }
    });

    if (!booking) {
      throw new AuthError('Booking not found', 404);
    }

    ensureCanManageBooking(input.actorUserId, input.actorRoles, booking.userId);

    if (!isBookingActive(booking.status)) {
      throw new AuthError('Only active bookings can be canceled', 409);
    }

    const baseAmount = await resolveBaseAmount(tx, {
      priceBookItemId: booking.priceBookItemId,
      overrideBaseAmount: input.baseAmount
    });
    const feePreview = calculateCancellationFee(booking.startAt, baseAmount, new Date());

    const parsed = parseBookingResourceKey(booking.resourceKey);
    const lockKey = `${parsed.sessionKey}|${booking.startAt.toISOString()}|${booking.endAt.toISOString()}`;

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELED
      }
    });

    const promotion = await promoteNextWaitlistedInTx(tx, {
      actorUserId: input.actorUserId,
      sessionKey: parsed.sessionKey,
      seatKey: parsed.seatKey,
      startAt: booking.startAt,
      endAt: booking.endAt,
      capacity: input.capacity
    });

    return {
      canceledBookingId: booking.id,
      feePreview,
      promotion
    };
  });
}

export async function previewCancellation(input: CancellationPreviewInput) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        userId: true,
        startAt: true,
        status: true,
        priceBookItemId: true
      }
    });

    if (!booking) {
      throw new AuthError('Booking not found', 404);
    }

    ensureCanManageBooking(input.actorUserId, input.actorRoles, booking.userId);

    if (!isBookingActive(booking.status)) {
      throw new AuthError('Only active bookings can be canceled', 409);
    }

    const baseAmount = await resolveBaseAmount(tx, {
      priceBookItemId: booking.priceBookItemId,
      overrideBaseAmount: input.baseAmount
    });

    return {
      bookingId: booking.id,
      preview: calculateCancellationFee(booking.startAt, baseAmount, new Date())
    };
  });
}

export async function rescheduleBooking(input: RescheduleBookingInput) {
  const newSessionKey = sanitizeKey(input.newSessionKey);
  const newSeatKey = sanitizeKey(input.newSeatKey);
  const newStartAt = toDateOrThrow(input.newStartAt, 'newStartAt');
  const newEndAt = toDateOrThrow(input.newEndAt, 'newEndAt');
  validateCapacity(input.capacity);

  if (newEndAt <= newStartAt) {
    throw new AuthError('newEndAt must be after newStartAt', 400);
  }

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        resourceKey: true,
        startAt: true,
        endAt: true,
        partySize: true,
        invoiceId: true,
        priceBookId: true,
        priceBookItemId: true
      }
    });

    if (!booking) {
      throw new AuthError('Booking not found', 404);
    }

    ensureCanManageBooking(input.actorUserId, input.actorRoles, booking.userId);

    if (!isBookingActive(booking.status)) {
      throw new AuthError('Only active bookings can be rescheduled', 409);
    }

    const oldParsed = parseBookingResourceKey(booking.resourceKey);
    const newResourceKey = bookingResourceKey(newSessionKey, newSeatKey);

    const isSameSlot =
      booking.resourceKey === newResourceKey &&
      booking.startAt.getTime() === newStartAt.getTime() &&
      booking.endAt.getTime() === newEndAt.getTime();

    if (isSameSlot) {
      throw new AuthError('New schedule is identical to current booking', 409);
    }

    const oldWindowSeconds = (booking.startAt.getTime() - Date.now()) / 1000;
    if (oldWindowSeconds < 2 * 60 * 60) {
      throw new AuthError('Reschedule is only allowed until at least 2 hours before class start', 403);
    }

    const ownerRoles = await getUserRoleCodes(tx, booking.userId);
    const opensAt = openingDateForUser(newStartAt, ownerRoles);
    if (new Date() < opensAt) {
      throw new AuthError('Target booking window is not open yet for this user', 403);
    }

    const lockKey = `${oldParsed.sessionKey}|${booking.startAt.toISOString()}|${booking.endAt.toISOString()}|${newSessionKey}|${newStartAt.toISOString()}|${newEndAt.toISOString()}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;

    const overlappingSeatBooking = await tx.booking.findFirst({
      where: {
        resourceKey: newResourceKey,
        status: {
          in: ACTIVE_BOOKING_STATUSES
        },
        id: {
          not: booking.id
        },
        startAt: {
          lt: newEndAt
        },
        endAt: {
          gt: newStartAt
        }
      },
      select: {
        id: true
      }
    });

    if (overlappingSeatBooking) {
      throw new AuthError('Target seat/resource is already booked for an overlapping time', 409);
    }

    const activeCountAtTarget = await activeSessionBookingsCount(tx, newSessionKey, newStartAt, newEndAt);
    const oldBookingAlreadyCountedInTarget =
      oldParsed.sessionKey === newSessionKey &&
      booking.startAt.getTime() === newStartAt.getTime() &&
      booking.endAt.getTime() === newEndAt.getTime();

    const effectiveCountAtTarget = oldBookingAlreadyCountedInTarget
      ? Math.max(activeCountAtTarget - 1, 0)
      : activeCountAtTarget;

    if (effectiveCountAtTarget >= input.capacity) {
      throw new AuthError('Target session capacity has been reached', 409);
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        resourceKey: newResourceKey,
        startAt: newStartAt,
        endAt: newEndAt,
        status: BookingStatus.CONFIRMED
      },
      select: {
        id: true,
        userId: true,
        resourceKey: true,
        startAt: true,
        endAt: true,
        status: true,
        partySize: true,
        updatedAt: true
      }
    });

    const oldSlotPromotion = await promoteNextWaitlistedInTx(tx, {
      actorUserId: input.actorUserId,
      sessionKey: oldParsed.sessionKey,
      seatKey: oldParsed.seatKey,
      startAt: booking.startAt,
      endAt: booking.endAt,
      capacity: input.capacity
    });

    return {
      booking: {
        ...updated,
        sessionKey: newSessionKey,
        seatKey: newSeatKey
      },
      oldSlotPromotion
    };
  });
}

export async function promoteNextWaitlisted(input: PromoteNextInput) {
  const sessionKey = sanitizeKey(input.sessionKey);
  const seatKey = sanitizeKey(input.seatKey);
  const startAt = toDateOrThrow(input.startAt, 'startAt');
  const endAt = toDateOrThrow(input.endAt, 'endAt');
  validateCapacity(input.capacity);

  if (endAt <= startAt) {
    throw new AuthError('endAt must be after startAt', 400);
  }

  const lockKey = `${sessionKey}|${startAt.toISOString()}|${endAt.toISOString()}|promote`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;

    return promoteNextWaitlistedInTx(tx, {
      actorUserId: input.actorUserId,
      sessionKey,
      seatKey,
      startAt,
      endAt,
      capacity: input.capacity
    });
  });
}
