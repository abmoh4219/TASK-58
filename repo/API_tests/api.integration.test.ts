import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const {
  loginUser,
  createBooking,
  getBookingAvailability,
  getEffectivePriceBook,
  getActiveWorkflowRuns,
  getNotificationHistory,
  getRecipeViewVolume,
  publishWebhookEvent,
  queryWebhookLogs,
  queryWebhookFailureAlerts,
  acknowledgeWebhookFailureAlert
} = vi.hoisted(() => ({
  loginUser: vi.fn(),
  createBooking: vi.fn(),
  getBookingAvailability: vi.fn(),
  getEffectivePriceBook: vi.fn(),
  getActiveWorkflowRuns: vi.fn(),
  getNotificationHistory: vi.fn(),
  getRecipeViewVolume: vi.fn(),
  publishWebhookEvent: vi.fn(),
  queryWebhookLogs: vi.fn(),
  queryWebhookFailureAlerts: vi.fn(),
  acknowledgeWebhookFailureAlert: vi.fn()
}));

vi.mock('../backend/src/modules/auth/auth.service', () => {
  class MockAuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    AuthError: MockAuthError,
    registerUser: vi.fn(),
    loginUser
  };
});

vi.mock('../backend/src/modules/bookings/booking.service', () => ({
  getBookingAvailability,
  createBooking,
  joinWaitlist: vi.fn(),
  getWaitlist: vi.fn(),
  previewCancellation: vi.fn(),
  cancelBooking: vi.fn(),
  rescheduleBooking: vi.fn(),
  promoteNextWaitlisted: vi.fn(),
  scheduleBookingReminder: vi.fn()
}));

vi.mock('../backend/src/modules/billing/billing.service', () => ({
  getEffectivePriceBook,
  resolveMembershipPrice: vi.fn(),
  createMembershipEnrollment: vi.fn(),
  renewMembership: vi.fn(),
  resolveCreditPackPrice: vi.fn(),
  purchaseCreditPack: vi.fn(),
  getCreditBalance: vi.fn(),
  consumeCredits: vi.fn(),
  getWalletBalance: vi.fn(),
  creditWallet: vi.fn(),
  debitWallet: vi.fn(),
  issueInvoice: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceOutstanding: vi.fn(),
  getAccountReceivables: vi.fn(),
  recordManualPayment: vi.fn()
}));

vi.mock('../backend/src/modules/workflows/workflow-run.service', () => ({
  createWorkflowRun: vi.fn(),
  pauseWorkflowRun: vi.fn(),
  resumeWorkflowRun: vi.fn(),
  tickWorkflowRun: vi.fn(),
  completeWorkflowStep: vi.fn(),
  skipWorkflowStep: vi.fn(),
  rollbackWorkflowStep: vi.fn(),
  getWorkflowRunState: vi.fn(),
  getActiveWorkflowRuns,
  getWorkflowRunEvents: vi.fn()
}));

vi.mock('../backend/src/modules/workflows/workflow-timeline.service', () => ({
  materializeWorkflowFromRecipe: vi.fn(),
  parseWorkflowVersionParam: vi.fn()
}));

vi.mock('../backend/src/modules/notifications/notification.service', () => ({
  createNotification: vi.fn(),
  dispatchDueNotifications: vi.fn(),
  getNotificationHistory,
  getNotificationPreference: vi.fn(),
  updateNotificationPreference: vi.fn()
}));

vi.mock('../backend/src/modules/analytics/analytics.service', () => ({
  trackRecipeView: vi.fn(),
  getRecipeViewVolume,
  getCuisineInterestDistribution: vi.fn(),
  getWeeklyConsistencyStreaks: vi.fn(),
  getDifficultyProgression: vi.fn(),
  getCompletionAccuracy: vi.fn()
}));

vi.mock('../backend/src/modules/webhooks/webhook.service', () => ({
  createWebhookConfig: vi.fn(),
  updateWebhookConfig: vi.fn(),
  listWebhookConfigs: vi.fn(),
  publishWebhookEvent,
  dispatchDueWebhookLogs: vi.fn(),
  queryWebhookLogs,
  queryWebhookFailureAlerts,
  acknowledgeWebhookFailureAlert
}));

vi.mock('../backend/src/modules/analytics/analytics-export.service', () => ({
  exportAnalyticsCsv: vi.fn()
}));

import { AUTH_COOKIE_NAME } from '../backend/src/modules/auth/auth.constants';
import { AuthError } from '../backend/src/modules/auth/auth.service';
import { buildApp } from '../backend/src/app';

describe('API tests', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function authCookie(roles: string[], sub = 'user-1'): string {
    const token = app.jwt.sign({ sub, username: sub, roles });
    return `${AUTH_COOKIE_NAME}=${token}`;
  }

  it('auth: login returns user payload', async () => {
    loginUser.mockResolvedValue({ id: 'u1', username: 'demo', roles: ['MEMBER'] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'demo',
        password: 'secret'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe('demo');
  });

  it('authorization negative: protected endpoint rejects anonymous access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings/availability?sessionKey=s&startAt=2026-03-01T00:00:00.000Z&endAt=2026-03-01T01:00:00.000Z&capacity=10'
    });

    expect(response.statusCode).toBe(401);
  });

  it('booking: availability endpoint returns data for authenticated user', async () => {
    getBookingAvailability.mockResolvedValue({
      sessionKey: 'group.class.demo',
      capacity: 10,
      activeBookings: 4,
      remainingCapacity: 6,
      isBookableNow: true
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings/availability?sessionKey=s&startAt=2026-03-01T00:00:00.000Z&endAt=2026-03-01T01:00:00.000Z&capacity=10',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().remainingCapacity).toBe(6);
  });

  it('billing: effective price book endpoint returns payload', async () => {
    getEffectivePriceBook.mockResolvedValue({
      id: 'pb1',
      code: 'DEFAULT',
      version: 3,
      currency: 'USD'
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/price-books/effective',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().code).toBe('DEFAULT');
  });

  it('booking validation: invalid query returns 400 before service logic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings/availability?sessionKey=s&startAt=2026-03-01T00:00:00.000Z&endAt=2026-03-01T01:00:00.000Z&capacity=abc',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('billing validation: invalid currency query returns 400 before service logic', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/price-books/effective?currency=USDX',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('workflow: active runs endpoint returns list', async () => {
    getActiveWorkflowRuns.mockResolvedValue([{ id: 'run-1', status: 'RUNNING' }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/runs/active',
      headers: {
        cookie: authCookie(['INSTRUCTOR'])
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runs).toHaveLength(1);
  });

  it('notification: history endpoint returns list', async () => {
    getNotificationHistory.mockResolvedValue({
      filters: {},
      notifications: [{ id: 'n1', status: 'SENT' }]
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/history',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().notifications[0].id).toBe('n1');
  });

  it('notification history validates filters and supports empty results', async () => {
    getNotificationHistory.mockResolvedValue({
      filters: { limit: 10 },
      notifications: []
    });

    const empty = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/history?limit=10',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().notifications).toEqual([]);

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/history?limit=0',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });
    expect(invalidLimit.statusCode).toBe(400);

    getNotificationHistory.mockRejectedValueOnce(new AuthError('to must be after from', 400));
    const inverted = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/history?from=2026-03-02T00:00:00.000Z&to=2026-03-01T00:00:00.000Z',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });
    expect(inverted.statusCode).toBe(400);
  });

  it('analytics: admin endpoint enforces role guard', async () => {
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/recipes/view-volume',
      headers: {
        cookie: authCookie(['MEMBER'])
      }
    });

    expect(forbidden.statusCode).toBe(403);

    getRecipeViewVolume.mockResolvedValue({ totals: { views: 10 }, topRecipes: [] });

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/recipes/view-volume',
      headers: {
        cookie: authCookie(['ADMIN'])
      }
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().totals.views).toBe(10);
  });

  it('authorization negative: admin-only billing wallet top-up rejects non-admin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/wallet/top-up',
      headers: {
        cookie: authCookie(['MEMBER']),
        'content-type': 'application/json'
      },
      payload: {
        amount: 10,
        currency: 'USD'
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it('webhook emit requires admin role', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/emit',
      payload: {
        eventKey: 'booking.success',
        payload: { bookingId: 'booking-1' }
      }
    });
    expect(anonymous.statusCode).toBe(401);

    const member = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/emit',
      headers: {
        cookie: authCookie(['MEMBER'])
      },
      payload: {
        eventKey: 'booking.success',
        payload: { bookingId: 'booking-1' }
      }
    });
    expect(member.statusCode).toBe(403);

    publishWebhookEvent.mockResolvedValue({ eventKey: 'booking.success', queued: 1 });
    const admin = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/emit',
      headers: {
        cookie: authCookie(['ADMIN'])
      },
      payload: {
        eventKey: 'booking.success',
        payload: { bookingId: 'booking-1' }
      }
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().queued).toBe(1);
  });

  it('webhook query endpoints enforce auth boundaries and support empty results', async () => {
    queryWebhookLogs.mockResolvedValue({ filters: { limit: 10 }, logs: [] });
    queryWebhookFailureAlerts.mockResolvedValue({ filters: { limit: 10 }, alerts: [] });
    acknowledgeWebhookFailureAlert.mockResolvedValue({ id: 'alert-1', status: 'ACKNOWLEDGED' });

    const memberLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/logs?limit=10',
      headers: { cookie: authCookie(['MEMBER']) }
    });
    expect(memberLogs.statusCode).toBe(403);

    const adminLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/logs?limit=10',
      headers: { cookie: authCookie(['ADMIN']) }
    });
    expect(adminLogs.statusCode).toBe(200);
    expect(adminLogs.json().logs).toEqual([]);

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/logs?limit=0',
      headers: { cookie: authCookie(['ADMIN']) }
    });
    expect(invalidLimit.statusCode).toBe(400);

    const alerts = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/failure-alerts?limit=10',
      headers: { cookie: authCookie(['ADMIN']) }
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.json().alerts).toEqual([]);

    const ack = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/failure-alerts/alert-1/ack',
      headers: { cookie: authCookie(['ADMIN']) }
    });
    expect(ack.statusCode).toBe(200);
  });
});
