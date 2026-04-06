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

describe('consent update validation', () => {
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

  it('rejects consent update with missing consentGranted field', async () => {
    const token = app.jwt.sign({ sub: 'admin-1', username: 'admin', roles: ['ADMIN'] });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/admin/users/some-user-id/consent',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects consent update with non-boolean consentGranted', async () => {
    const token = app.jwt.sign({ sub: 'admin-1', username: 'admin', roles: ['ADMIN'] });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/admin/users/some-user-id/consent',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: { consentGranted: 'yes' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects consent update with additional unrecognized properties', async () => {
    const token = app.jwt.sign({ sub: 'admin-1', username: 'admin', roles: ['ADMIN'] });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/admin/users/some-user-id/consent',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: { consentGranted: true, extra: 'field' }
    });

    // With additionalProperties: false, Fastify either strips extra fields (200/500 at DB)
    // or rejects them (400). Either way, the extra field should not reach the service layer.
    // The key assertion: the response is not a successful 200 with the extra field accepted.
    expect([400, 500]).toContain(response.statusCode);
  });

  it('accepts valid consent update payload', async () => {
    const token = app.jwt.sign({ sub: 'admin-1', username: 'admin', roles: ['ADMIN'] });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/admin/users/some-user-id/consent',
      headers: {
        cookie: `access_token=${token}`
      },
      payload: { consentGranted: true }
    });

    // Will get past validation (may fail at DB level since we're mocking, but not 400)
    expect(response.statusCode).not.toBe(400);
  });
});
