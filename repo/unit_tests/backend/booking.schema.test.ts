import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn()
}));

vi.mock('../../backend/src/lib/prisma', () => ({
  prisma: {
    $queryRaw: queryRaw
  }
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    async connect() {
      return undefined;
    }

    async ping() {
      return 'PONG';
    }

    disconnect() {
      return undefined;
    }
  }
}));

import { buildApp } from '../../backend/src/app';
import { resetEnvCache } from '../../backend/src/config/env';

describe('booking route schema validation', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET = 'test_access_secret';
    process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
    process.env.NODE_ENV = 'development';
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    resetEnvCache();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetEnvCache();
  });

  it('accepts booking creation with userId field for on-behalf booking', async () => {
    const token = app.jwt.sign({ sub: 'desk-1', username: 'desk', roles: ['FRONT_DESK'] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings/',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        sessionKey: 'session-1',
        seatKey: 'seat-1',
        startAt: '2026-04-10T10:00:00.000Z',
        endAt: '2026-04-10T11:00:00.000Z',
        capacity: 4
      }
    });

    // Should not be 400 (schema rejection) - may fail at DB level
    expect(response.statusCode).not.toBe(400);
  });

  it('rejects booking creation with invalid userId format', async () => {
    const token = app.jwt.sign({ sub: 'desk-1', username: 'desk', roles: ['FRONT_DESK'] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings/',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: {
        userId: 'not-a-uuid',
        sessionKey: 'session-1',
        seatKey: 'seat-1',
        startAt: '2026-04-10T10:00:00.000Z',
        endAt: '2026-04-10T11:00:00.000Z',
        capacity: 4
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it('accepts booking creation without userId for self-booking', async () => {
    const token = app.jwt.sign({ sub: 'member-1', username: 'member', roles: ['MEMBER'] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings/',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: {
        sessionKey: 'session-1',
        seatKey: 'seat-1',
        startAt: '2026-04-10T10:00:00.000Z',
        endAt: '2026-04-10T11:00:00.000Z',
        capacity: 4
      }
    });

    // Should not be 400 (schema rejection)
    expect(response.statusCode).not.toBe(400);
  });
});
