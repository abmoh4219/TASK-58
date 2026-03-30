import { createHmac, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('real backend integration (postgres + prisma migrations)', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const backendRoot = path.join(repoRoot, 'backend');

  const sourceDatabaseUrl = process.env.REAL_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!sourceDatabaseUrl) {
    throw new Error('REAL_INTEGRATION_DATABASE_URL or DATABASE_URL is required for real integration tests');
  }

  const integrationDatabaseUrl = sourceDatabaseUrl;
  const baseUrl = (process.env.REAL_INTEGRATION_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

  let prisma: any;
  let authCookieName = 'access_token';
  let bodyHashFn: (payload: unknown) => string;

  const seeded = {
    admin: { id: '', username: '', password: 'RealAdminPass123!' },
    frontDesk: { id: '', username: '', password: 'RealDeskPass123!' },
    instructor: { id: '', username: '', password: 'RealInstructorPass123!' },
    memberA: { id: '', username: '', password: 'RealMemberAPass123!' },
    memberB: { id: '', username: '', password: 'RealMemberBPass123!' }
  };

  const billingSeed = {
    membershipPlanId: ''
  };

  function utcIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  }

  async function login(username: string, password: string): Promise<{ cookie: string; userId: string }> {
    const response = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      payload: {
        username,
        password
      }
    });

    expect(response.statusCode, `Login should succeed for ${username}`).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie[0].split(';')[0]
      : (setCookie || '').split(';')[0];
    expect(cookieHeader.startsWith(`${authCookieName}=`), 'Auth cookie should be returned').toBe(true);

    return {
      cookie: cookieHeader,
      userId: response.json().user.id as string
    };
  }

  function signedHeaders(input: {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    payload: unknown;
    nonce: string;
    idempotencyKey: string;
  }) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const canonical = [
      input.method,
      input.path,
      timestamp,
      input.nonce,
      '',
      bodyHashFn(input.payload)
    ].join('\n');

    const signature = createHmac('sha256', process.env.SIGNED_REQUEST_SECRET || '')
      .update(canonical)
      .digest('hex');

    return {
      'content-type': 'application/json',
      'x-key-id': process.env.SIGNED_REQUEST_KEY_ID || 'default',
      'x-timestamp': timestamp,
      'x-nonce': input.nonce,
      'x-signature': signature,
      'idempotency-key': input.idempotencyKey
    };
  }

  async function request(input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    cookie?: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) {
    const response = await fetch(`${baseUrl}${input.path}`, {
      method: input.method,
      headers: {
        ...(input.cookie ? { cookie: input.cookie } : {}),
        ...(input.payload ? { 'content-type': 'application/json' } : {}),
        ...(input.headers || {})
      },
      ...(input.payload ? { body: JSON.stringify(input.payload) } : {})
    });

    const text = await response.text();

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      json: () => (text ? JSON.parse(text) : null)
    };
  }

  async function seedUser(input: {
    username: string;
    password: string;
    roles: string[];
    UserStatus: any;
    hashPassword: (raw: string) => Promise<string>;
  }): Promise<string> {
    const passwordHash = await input.hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        username: input.username,
        displayName: input.username,
        status: input.UserStatus.ACTIVE,
        passwordHash,
        consentGranted: true,
        consentGrantedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      },
      select: {
        id: true
      }
    });

    for (const roleCode of input.roles) {
      const role = await prisma.role.findUnique({
        where: { code: roleCode },
        select: { id: true }
      });

      if (role) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id
          }
        });
      }
    }

    return user.id;
  }

  async function seedRecipe(name: string): Promise<string> {
    const recipe = await prisma.recipe.create({
      data: {
        code: `RECIPE-${randomUUID().slice(0, 8)}`,
        name,
        status: 'DRAFT',
        version: 1,
        steps: {
          create: [
            {
              phaseNumber: 1,
              positionInPhase: 1,
              title: `${name} step`,
              durationSeconds: 0,
              waitSeconds: 0
            }
          ]
        }
      },
      select: {
        id: true
      }
    });

    return recipe.id;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'real_it_access_secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'real_it_refresh_secret';
    process.env.SIGNED_REQUEST_SECRET = process.env.SIGNED_REQUEST_SECRET || 'real_it_signed_request_secret';
    process.env.SIGNED_REQUEST_KEY_ID = process.env.SIGNED_REQUEST_KEY_ID || 'default';
    process.env.SECURITY_ACTION_PATH_PREFIXES = '/bookings,/billing,/invoices,/payments';
    process.env.FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY || 'real_it_field_encryption_key_32!!';
    process.env.TRUST_PROXY = 'false';
    process.env.BOOKING_OPEN_HOURS_NON_MEMBER = '0';
    process.env.BOOKING_MEMBER_EARLY_ACCESS_HOURS = '0';

    execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
      cwd: backendRoot,
      env: {
        ...process.env,
        DATABASE_URL: integrationDatabaseUrl
      },
      stdio: 'pipe'
    });

    const [{ PrismaClient, UserStatus, MembershipPlanStatus, PriceBookStatus, InvoiceLineType }, { hashPassword }, authConstants, securityUtils] = await Promise.all([
      import('../backend/prisma/generated'),
      import('../backend/src/modules/auth/password.service'),
      import('../backend/src/modules/auth/auth.constants'),
      import('../backend/src/modules/security/security.utils')
    ]);

    bodyHashFn = securityUtils.bodyHash;
    authCookieName = authConstants.AUTH_COOKIE_NAME;

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: integrationDatabaseUrl
        }
      }
    });

    for (const roleCode of ['USER', 'MEMBER', 'FRONT_DESK', 'INSTRUCTOR', 'ADMIN']) {
      await prisma.role.upsert({
        where: { code: roleCode },
        update: {},
        create: {
          code: roleCode,
          name: roleCode
        }
      });
    }

    seeded.admin.username = `real-admin-${randomUUID().slice(0, 8)}@example.local`;
    seeded.frontDesk.username = `real-desk-${randomUUID().slice(0, 8)}@example.local`;
    seeded.instructor.username = `real-inst-${randomUUID().slice(0, 8)}@example.local`;
    seeded.memberA.username = `real-member-a-${randomUUID().slice(0, 8)}@example.local`;
    seeded.memberB.username = `real-member-b-${randomUUID().slice(0, 8)}@example.local`;

    seeded.admin.id = await seedUser({ username: seeded.admin.username, password: seeded.admin.password, roles: ['ADMIN'], UserStatus, hashPassword });
    seeded.frontDesk.id = await seedUser({ username: seeded.frontDesk.username, password: seeded.frontDesk.password, roles: ['FRONT_DESK'], UserStatus, hashPassword });
    seeded.instructor.id = await seedUser({ username: seeded.instructor.username, password: seeded.instructor.password, roles: ['INSTRUCTOR'], UserStatus, hashPassword });
    seeded.memberA.id = await seedUser({ username: seeded.memberA.username, password: seeded.memberA.password, roles: ['MEMBER'], UserStatus, hashPassword });
    seeded.memberB.id = await seedUser({ username: seeded.memberB.username, password: seeded.memberB.password, roles: ['MEMBER'], UserStatus, hashPassword });

    const membershipPlan = await prisma.membershipPlan.create({
      data: {
        code: `PLAN-${randomUUID().slice(0, 8)}`,
        name: 'Integration Membership',
        durationDays: 30,
        includedCredits: 4,
        status: MembershipPlanStatus.ACTIVE
      },
      select: { id: true }
    });
    billingSeed.membershipPlanId = membershipPlan.id;

    const book = await prisma.priceBook.create({
      data: {
        code: `PB-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: 'Integration Price Book',
        currency: 'USD',
        status: PriceBookStatus.PUBLISHED,
        validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
        publishedAt: new Date()
      },
      select: { id: true }
    });

    await prisma.priceBookItem.create({
      data: {
        priceBookId: book.id,
        sku: `SKU-${randomUUID().slice(0, 8)}`,
        label: 'Integration Membership Item',
        lineType: InvoiceLineType.MEMBERSHIP_PLAN,
        membershipPlanId: membershipPlan.id,
        unitAmount: 120,
        taxAmount: 0,
        isTaxInclusive: false
      }
    });

  }, 120000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it('registers user with consent and stores consent flags', async () => {
    const response = await request({
      method: 'POST',
      path: '/api/v1/auth/register',
      payload: {
        username: `consent-${randomUUID().slice(0, 8)}@example.local`,
        password: 'ConsentPass123!',
        consentGranted: true
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.consentGranted, 'Consent must be stored as true').toBe(true);
    expect(response.json().user.consentGrantedAt, 'Consent timestamp must be returned').toBeTruthy();
  });

  it('supports golden path across auth, booking, waitlist, cancellation, and notifications', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);
    const memberB = await login(seeded.memberB.username, seeded.memberB.password);

    const startAt = utcIso(3);
    const endAt = utcIso(4);
    const sessionKey = `golden-${randomUUID().slice(0, 6)}`;

    const browse = await request({
      method: 'GET',
      path: `/api/v1/bookings/availability?sessionKey=${sessionKey}&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}&capacity=1`,
      headers: { cookie: memberA.cookie }
    });
    expect(browse.statusCode, 'Offerings/availability lookup should succeed').toBe(200);

    const createPath = '/api/v1/bookings';
    const createPayload = {
      sessionKey,
      seatKey: 'station-1',
      startAt,
      endAt,
      capacity: 1,
      partySize: 1
    };
    const create = await request({
      method: 'POST',
      path: createPath,
      headers: {
        cookie: memberA.cookie,
        ...signedHeaders({
          method: 'POST',
          path: createPath,
          payload: createPayload,
          nonce: `golden-create-${Date.now()}`,
          idempotencyKey: `golden-create-idem-${Date.now()}`
        })
      },
      payload: createPayload
    });
    expect(create.statusCode, 'Booking creation should succeed').toBe(201);
    const bookingId = create.json().booking.id as string;

    const waitlistPath = '/api/v1/bookings/waitlist';
    const waitlistPayload = {
      sessionKey,
      startAt,
      endAt,
      capacity: 1,
      contact: seeded.memberB.username
    };
    const waitlist = await request({
      method: 'POST',
      path: waitlistPath,
      headers: {
        cookie: memberB.cookie,
        ...signedHeaders({
          method: 'POST',
          path: waitlistPath,
          payload: waitlistPayload,
          nonce: `golden-wait-${Date.now()}`,
          idempotencyKey: `golden-wait-idem-${Date.now()}`
        })
      },
      payload: waitlistPayload
    });
    expect(waitlist.statusCode, 'Waitlist join should succeed').toBe(201);

    const cancelPath = `/api/v1/bookings/${bookingId}/cancel-confirm`;
    const cancelPayload = { capacity: 1, baseAmount: 100 };
    const cancel = await request({
      method: 'POST',
      path: cancelPath,
      headers: {
        cookie: memberA.cookie,
        ...signedHeaders({
          method: 'POST',
          path: cancelPath,
          payload: cancelPayload,
          nonce: `golden-cancel-${Date.now()}`,
          idempotencyKey: `golden-cancel-idem-${Date.now()}`
        })
      },
      payload: cancelPayload
    });
    expect(cancel.statusCode, 'Cancellation confirmation should succeed').toBe(200);
    expect(cancel.json().feePreview.feePercent, 'Fee should be 50% for 3h window').toBe(50);
    expect(cancel.json().promotion.promoted, 'Cancellation should promote waitlist user').toBe(true);

    let history: any;
    let promotedNotificationFound = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      history = await request({
        method: 'GET',
        path: '/api/v1/notifications/history',
        headers: { cookie: memberB.cookie }
      });
      expect(history.statusCode, 'Notification history should be accessible').toBe(200);

      const notifications = history.json().notifications as Array<any>;
      promotedNotificationFound = notifications.some(
        (item) =>
          item.scenario === 'WAITLIST_PROMOTION' &&
          item.payloadJson &&
          item.payloadJson.bookingId === cancel.json().promotion.booking.id
      );

      if (promotedNotificationFound) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(promotedNotificationFound, 'Waitlist promotion notification should exist').toBe(true);
  }, 120000);

  it('rejects overlapping booking conflict with 409', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);
    const memberB = await login(seeded.memberB.username, seeded.memberB.password);

    const startAt = utcIso(6);
    const endAt = utcIso(7);
    const sessionKey = `conflict-${randomUUID().slice(0, 6)}`;

    const pathName = '/api/v1/bookings';
    const firstPayload = {
      sessionKey,
      seatKey: 'station-1',
      startAt,
      endAt,
      capacity: 10,
      partySize: 1
    };
    const first = await request({
      method: 'POST',
      path: pathName,
      headers: {
        cookie: memberA.cookie,
        ...signedHeaders({
          method: 'POST',
          path: pathName,
          payload: firstPayload,
          nonce: `conflict-a-${Date.now()}`,
          idempotencyKey: `conflict-a-idem-${Date.now()}`
        })
      },
      payload: firstPayload
    });
    expect(first.statusCode).toBe(201);

    const secondPayload = {
      ...firstPayload
    };
    const second = await request({
      method: 'POST',
      path: pathName,
      headers: {
        cookie: memberB.cookie,
        ...signedHeaders({
          method: 'POST',
          path: pathName,
          payload: secondPayload,
          nonce: `conflict-b-${Date.now()}`,
          idempotencyKey: `conflict-b-idem-${Date.now()}`
        })
      },
      payload: secondPayload
    });
    expect(second.statusCode, 'Overlapping seat booking must be rejected').toBe(409);
  }, 120000);

  it('enforces object-level booking authorization via API layer', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);
    const memberB = await login(seeded.memberB.username, seeded.memberB.password);

    const startAt = utcIso(8);
    const endAt = utcIso(9);
    const sessionKey = `authz-${randomUUID().slice(0, 6)}`;

    const createPath = '/api/v1/bookings';
    const createPayload = {
      sessionKey,
      seatKey: 'station-1',
      startAt,
      endAt,
      capacity: 10,
      partySize: 1
    };
    const create = await request({
      method: 'POST',
      path: createPath,
      headers: {
        cookie: memberA.cookie,
        ...signedHeaders({
          method: 'POST',
          path: createPath,
          payload: createPayload,
          nonce: `authz-create-${Date.now()}`,
          idempotencyKey: `authz-create-idem-${Date.now()}`
        })
      },
      payload: createPayload
    });
    expect(create.statusCode).toBe(201);
    const bookingId = create.json().booking.id as string;

    const preview = await request({
      method: 'GET',
      path: `/api/v1/bookings/${bookingId}/cancellation-preview`,
      headers: { cookie: memberB.cookie }
    });
    expect(preview.statusCode, 'Other member must not preview another booking').toBe(403);

    const cancel = await request({
      method: 'POST',
      path: `/api/v1/bookings/${bookingId}/cancel-confirm`,
      headers: {
        cookie: memberB.cookie,
        ...signedHeaders({
          method: 'POST',
          path: `/api/v1/bookings/${bookingId}/cancel-confirm`,
          payload: { capacity: 10 },
          nonce: `authz-cancel-${Date.now()}`,
          idempotencyKey: `authz-cancel-idem-${Date.now()}`
        })
      },
      payload: { capacity: 10 }
    });
    expect(cancel.statusCode, 'Other member must not cancel another booking').toBe(403);

    const reschedulePayload = {
      newSessionKey: `${sessionKey}-new`,
      newSeatKey: 'station-2',
      newStartAt: utcIso(10),
      newEndAt: utcIso(11),
      capacity: 10
    };

    const reschedule = await request({
      method: 'POST',
      path: `/api/v1/bookings/${bookingId}/reschedule`,
      headers: {
        cookie: memberB.cookie,
        ...signedHeaders({
          method: 'POST',
          path: `/api/v1/bookings/${bookingId}/reschedule`,
          payload: reschedulePayload,
          nonce: `authz-res-${Date.now()}`,
          idempotencyKey: `authz-res-idem-${Date.now()}`
        })
      },
      payload: reschedulePayload
    });
    expect(reschedule.statusCode, 'Other member must not reschedule another booking').toBe(403);
  }, 120000);

  it('allows front desk and admin to manage booking', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);
    const desk = await login(seeded.frontDesk.username, seeded.frontDesk.password);
    const admin = await login(seeded.admin.username, seeded.admin.password);

    const startAt = utcIso(12);
    const endAt = utcIso(13);
    const sessionKey = `staff-${randomUUID().slice(0, 6)}`;

    const create = await request({
      method: 'POST',
      path: '/api/v1/bookings',
      headers: {
        cookie: memberA.cookie,
        ...signedHeaders({
          method: 'POST',
          path: '/api/v1/bookings',
          payload: {
            sessionKey,
            seatKey: 'station-1',
            startAt,
            endAt,
            capacity: 10,
            partySize: 1
          },
          nonce: `staff-create-${Date.now()}`,
          idempotencyKey: `staff-create-idem-${Date.now()}`
        })
      },
      payload: {
        sessionKey,
        seatKey: 'station-1',
        startAt,
        endAt,
        capacity: 10,
        partySize: 1
      }
    });
    expect(create.statusCode).toBe(201);
    const bookingId = create.json().booking.id as string;

    const deskPreview = await request({
      method: 'GET',
      path: `/api/v1/bookings/${bookingId}/cancellation-preview`,
      headers: { cookie: desk.cookie }
    });
    expect(deskPreview.statusCode, 'Front desk should be allowed to manage booking').toBe(200);

    const adminPreview = await request({
      method: 'GET',
      path: `/api/v1/bookings/${bookingId}/cancellation-preview`,
      headers: { cookie: admin.cookie }
    });
    expect(adminPreview.statusCode, 'Admin should be allowed to manage booking').toBe(200);
  }, 120000);

  it('enforces workflow booking reference authorization on create', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);
    const memberB = await login(seeded.memberB.username, seeded.memberB.password);
    const desk = await login(seeded.frontDesk.username, seeded.frontDesk.password);
    const admin = await login(seeded.admin.username, seeded.admin.password);

    const startAt = utcIso(14);
    const endAt = utcIso(15);
    const sessionKey = `workflow-${randomUUID().slice(0, 6)}`;
    const recipeId = await seedRecipe('Workflow Auth Recipe');

    const createBookingPayload = {
      sessionKey,
      seatKey: 'station-1',
      startAt,
      endAt,
      capacity: 5,
      partySize: 1
    };
    const bookingCreate = await request({
      method: 'POST',
      path: '/api/v1/bookings',
      headers: {
        cookie: memberA.cookie,
        ...signedHeaders({
          method: 'POST',
          path: '/api/v1/bookings',
          payload: createBookingPayload,
          nonce: `workflow-booking-${Date.now()}`,
          idempotencyKey: `workflow-booking-idem-${Date.now()}`
        })
      },
      payload: createBookingPayload
    });
    expect(bookingCreate.statusCode).toBe(201);
    const bookingId = bookingCreate.json().booking.id as string;

    const foreignAttempt = await request({
      method: 'POST',
      path: '/api/v1/workflows/runs',
      headers: { cookie: memberB.cookie },
      payload: {
        recipeId,
        bookingId
      }
    });
    expect(foreignAttempt.statusCode, 'Other members must not reference another user booking in workflow runs').toBe(403);

    const ownerAttempt = await request({
      method: 'POST',
      path: '/api/v1/workflows/runs',
      headers: { cookie: memberA.cookie },
      payload: {
        recipeId,
        bookingId
      }
    });
    expect(ownerAttempt.statusCode, 'Booking owner should be allowed to create workflow runs').toBe(201);

    const deskAttempt = await request({
      method: 'POST',
      path: '/api/v1/workflows/runs',
      headers: { cookie: desk.cookie },
      payload: {
        recipeId,
        bookingId
      }
    });
    expect(deskAttempt.statusCode, 'Front desk should be allowed to reference booking workflows').toBe(201);

    const adminAttempt = await request({
      method: 'POST',
      path: '/api/v1/workflows/runs',
      headers: { cookie: admin.cookie },
      payload: {
        recipeId,
        bookingId
      }
    });
    expect(adminAttempt.statusCode, 'Admin should be allowed to reference booking workflows').toBe(201);
  }, 120000);

  it('creates invoice and persists immutable billing snapshots', async () => {
    const admin = await login(seeded.admin.username, seeded.admin.password);

    const pathName = '/api/v1/billing/invoices/issue';
    const payload = {
      customerUserId: seeded.memberA.id,
      currency: 'USD',
      discountPercent: 10,
      discountReason: 'Promo test',
      lines: [
        {
          type: 'MEMBERSHIP_PLAN',
          membershipPlanId: billingSeed.membershipPlanId,
          quantity: 1
        }
      ]
    };

    const response = await request({
      method: 'POST',
      path: pathName,
      headers: {
        cookie: admin.cookie,
        ...signedHeaders({
          method: 'POST',
          path: pathName,
          payload,
          nonce: `invoice-${Date.now()}`,
          idempotencyKey: `invoice-idem-${Date.now()}`
        })
      },
      payload
    });

    expect(response.statusCode, 'Invoice issuance should succeed').toBe(201);
    const invoiceId = response.json().invoice.id as string;

    const invoiceRow = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        priceBookCodeSnapshot: true,
        priceBookVersionSnapshot: true,
        totalAmountSnapshot: true,
        discountAmountSnapshot: true
      }
    });
    expect(invoiceRow?.priceBookCodeSnapshot, 'Price book code snapshot should persist').toBeTruthy();
    expect(invoiceRow?.priceBookVersionSnapshot, 'Price book version snapshot should persist').toBeTruthy();
    expect(Number(invoiceRow?.totalAmountSnapshot ?? 0), 'Invoice total should be persisted').toBeGreaterThan(0);
    expect(Number(invoiceRow?.discountAmountSnapshot ?? 0), 'Discount snapshot should be persisted').toBeGreaterThan(0);
  }, 120000);

  it('prevents duplicate idempotent processing on signed mutation', async () => {
    const admin = await login(seeded.admin.username, seeded.admin.password);

    const pathName = '/api/v1/billing/wallet/top-up';
    const payload = {
      userId: seeded.memberA.id,
      amount: 25,
      currency: 'USD',
      reason: 'idempotency-integration-test'
    };

    const idempotencyKey = `idem-real-${Date.now()}`;
    const first = await request({
      method: 'POST',
      path: pathName,
      headers: {
        cookie: admin.cookie,
        ...signedHeaders({
          method: 'POST',
          path: pathName,
          payload,
          nonce: `idem-nonce-1-${Date.now()}`,
          idempotencyKey
        })
      },
      payload
    });

    const second = await request({
      method: 'POST',
      path: pathName,
      headers: {
        cookie: admin.cookie,
        ...signedHeaders({
          method: 'POST',
          path: pathName,
          payload,
          nonce: `idem-nonce-2-${Date.now()}`,
          idempotencyKey
        })
      },
      payload
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode, 'Second request should return cached idempotent response').toBe(200);
    expect(second.json()).toEqual(first.json());
  }, 120000);

  it('covers 404 and invalid access edge cases', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);
    const memberB = await login(seeded.memberB.username, seeded.memberB.password);

    const invalidBookingId = 'not-a-valid-booking-id';
    const invalidBookingIdResponse = await request({
      method: 'GET',
      path: `/api/v1/bookings/${invalidBookingId}/cancellation-preview`,
      headers: { cookie: memberA.cookie }
    });
    expect(invalidBookingIdResponse.statusCode, 'Malformed booking id should be rejected').toBe(400);

    const preview404 = await request({
      method: 'GET',
      path: `/api/v1/bookings/${randomUUID()}/cancellation-preview`,
      headers: { cookie: memberA.cookie }
    });
    expect(preview404.statusCode, 'Missing booking should return 404').toBe(404);

    const workflow404 = await request({
      method: 'GET',
      path: `/api/v1/workflows/runs/${randomUUID()}`,
      headers: { cookie: memberA.cookie }
    });
    expect(workflow404.statusCode, 'Missing workflow run should return 404').toBe(404);

    const invalidWorkflowId = 'x'.repeat(130);
    const workflowInvalid = await request({
      method: 'GET',
      path: `/api/v1/workflows/runs/${invalidWorkflowId}`,
      headers: { cookie: memberA.cookie }
    });
    expect(workflowInvalid.statusCode, 'Invalid workflow run id should not resolve').toBe(404);

    const notificationsForbidden = await request({
      method: 'GET',
      path: `/api/v1/notifications/history?userId=${seeded.memberA.id}`,
      headers: { cookie: memberB.cookie }
    });
    expect(notificationsForbidden.statusCode, 'Member should not read another user notification history').toBe(403);
  }, 120000);

  it('keeps encrypted fields out of API response and encrypted at rest', async () => {
    const memberA = await login(seeded.memberA.username, seeded.memberA.password);

    const plainBody = 'private-body-plaintext';
    const plainDestination = 'member@example.local';

    const createEvent = await request({
      method: 'POST',
      path: '/api/v1/notifications/events',
      headers: {
        cookie: memberA.cookie,
        'content-type': 'application/json'
      },
      payload: {
        scenario: 'BOOKING_SUCCESS',
        body: plainBody,
        destination: plainDestination,
        autoDeliver: false
      }
    });
    expect(createEvent.statusCode).toBe(201);

    const row = await prisma.notification.findFirst({
      where: { userId: memberA.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        bodyCiphertext: true,
        bodyIv: true,
        destinationCiphertext: true,
        destinationIv: true
      }
    });

    expect(row?.bodyCiphertext, 'Notification body ciphertext should be stored').toBeTruthy();
    expect(row?.destinationCiphertext, 'Notification destination ciphertext should be stored').toBeTruthy();
    expect(row?.bodyCiphertext === plainBody, 'Plain body must not be stored as raw ciphertext').toBe(false);
    expect(row?.destinationCiphertext === plainDestination, 'Plain destination must not be stored raw').toBe(false);
    expect(row?.bodyIv, 'Notification body IV should be persisted').toBeTruthy();
    expect(row?.destinationIv, 'Notification destination IV should be persisted').toBeTruthy();

    const history = await request({
      method: 'GET',
      path: '/api/v1/notifications/history',
      headers: { cookie: memberA.cookie }
    });

    expect(history.statusCode).toBe(200);
    const notification = history.json().notifications[0];
    expect(notification.bodyCiphertext, 'Encrypted internal fields must not be exposed by API').toBeUndefined();
    expect(notification.destinationCiphertext, 'Encrypted internal fields must not be exposed by API').toBeUndefined();
  }, 120000);
});
