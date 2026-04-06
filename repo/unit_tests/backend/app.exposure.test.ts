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

describe('operational exposure controls', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET = 'test_access_secret';
    process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
    process.env.REDIS_URL = 'redis://localhost:6379';
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  });

  afterEach(() => {
    resetEnvCache();
  });

  it('requires authentication for swagger docs outside development', async () => {
    process.env.NODE_ENV = 'test';
    resetEnvCache();
    const app = buildApp();
    await app.ready();

    const docs = await app.inject({
      method: 'GET',
      url: '/api/docs/'
    });
    expect(docs.statusCode).toBe(401);

    const readiness = await app.inject({
      method: 'GET',
      url: '/health/ready'
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({ status: 'ready' });

    await app.close();
  });

  it('exposes swagger docs and detailed readiness checks in development', async () => {
    process.env.NODE_ENV = 'development';
    resetEnvCache();
    const app = buildApp();
    await app.ready();

    const docs = await app.inject({
      method: 'GET',
      url: '/api/docs'
    });
    expect(docs.statusCode).toBe(302);
    expect(docs.headers.location).toContain('docs/static/index.html');

    const readiness = await app.inject({
      method: 'GET',
      url: '/health/ready'
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json().status).toBe('ready');

    await app.close();
  });
});
