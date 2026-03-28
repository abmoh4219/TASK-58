# Culinary Studio Operations & Recipe Coach Platform

Initial fullstack monorepo scaffold for an offline/LAN-capable platform.

## Tech Stack

- Frontend: SvelteKit + TypeScript + Tailwind CSS + shadcn-svelte
- Backend: Node.js + Fastify
- Database: PostgreSQL
- Queue/Cache: Redis
- ORM: Prisma
- Auth strategy: JWT in HttpOnly cookies (scaffold only)
- Containerization: Docker + Docker Compose

## Monorepo Layout

```text
.
├── API_tests/
├── backend/
├── docs/
├── frontend/
├── unit_tests/
├── .env.example
├── .gitignore
├── docker-compose.yml
└── README.md
```

## Quick Start

1. Copy environment template:

```bash
cp .env.example .env
```

2. Build and run all services:

```bash
docker compose up --build
```

3. Access services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## LAN / Offline Notes

- Services are fully containerized and communicate on an internal Docker network.
- Backend and frontend bind to `0.0.0.0` for LAN accessibility.
- No cloud dependencies are required at runtime.
- First-time image/dependency pulls require internet access unless your Docker/npm caches are pre-warmed or mirrored locally.

## Local HTTPS Readiness

This scaffold is HTTP-first for local development, but it is ready to be fronted by TLS locally:

- Add a local reverse proxy container (for example Caddy or Nginx) that terminates TLS.
- Generate trusted local certificates with `mkcert` (or your internal CA).
- Route HTTPS traffic to:
  - frontend service on port `5173`
  - backend service on port `4000`
- Keep JWT cookies configured for `HttpOnly`; when enabling HTTPS, also enforce `Secure` cookies in backend auth configuration.

## Current Scope

- Included: project structure, tooling, container orchestration, base runtime wiring.
- Included: Prisma schema + initial SQL migration for users/roles, pricing, invoices, payments, wallets, and discount overrides.
- Intentionally excluded: business logic, API endpoints, UI pages.

## Database Migrations

- Prisma schema: `backend/prisma/schema.prisma`
- Initial migration: `backend/prisma/migrations/20260328130000_initial_billing_core/migration.sql`
- Booking/waitlist/workflow migration: `backend/prisma/migrations/20260328143000_booking_waitlist_workflow/migration.sql`
- Notifications/audit/webhooks migration: `backend/prisma/migrations/20260328153000_notifications_audit_webhooks/migration.sql`
- Auth foundation migration: `backend/prisma/migrations/20260328170000_auth_foundation/migration.sql`
- Security hardening migration: `backend/prisma/migrations/20260328183000_security_rbac_lockout_rate_limit/migration.sql`
- Signed request/idempotency migration: `backend/prisma/migrations/20260328193000_signed_requests_idempotency/migration.sql`
- Run local dev migration from `backend/`:

```bash
npm run prisma:migrate:dev
```

## Auth Foundation

- Routes:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /auth/me` (JWT cookie protected)
- Role-protected route example:
  - `GET /auth/admin/health` (requires `ADMIN` role)
- Authentication uses JWT in `HttpOnly` cookie `access_token`.
- Passwords are hashed with Argon2id.
- Registration captures consent (`consentGranted` + `consentGrantedAt`) and applies data-minimization defaults.
- Account lockout: after 10 failed login attempts, account is locked for 15 minutes (configurable by env vars).
- Request rate limiting: 60 requests/minute keyed by authenticated user where possible, otherwise by IP.
- Signed requests for booking/billing action paths (`POST|PUT|PATCH|DELETE` on configured prefixes) require:
  - `X-Key-Id`
  - `X-Timestamp` (unix seconds)
  - `X-Nonce`
  - `X-Signature` (hex HMAC SHA-256)
- Signed request canonical string format:
  - `METHOD\nPATH\nTIMESTAMP\nNONCE\nUSER_ID_OR_EMPTY\nSHA256(STABLE_JSON_BODY)`
- Replay protection stores nonce scopes (`user:<id>` or `ip:<ip>`) and rejects reused nonces.
- Idempotency for booking/billing action paths requires `Idempotency-Key` and stores request/response outcomes for safe replay.

## Booking API (Part 1)

- Routes:
  - `GET /bookings/availability?sessionKey=<key>&startAt=<iso>&endAt=<iso>&capacity=<int>`
  - `POST /bookings`
- `POST /bookings` request body:
  - `sessionKey` (logical class/session id)
  - `seatKey` (seat/resource unit inside the session)
  - `startAt`, `endAt` (ISO timestamps)
  - `capacity` (session capacity)
  - optional: `partySize`, `invoiceId`, `priceBookId`, `priceBookItemId`, `notes`
- Resource key convention: booking seat resource is stored as `sessionKey::seatKey`.
- Overlap prevention:
  - API pre-check blocks overlapping active bookings for the same seat/resource.
  - DB exclusion constraint remains the final guard for overlaps on the same resource.
- Capacity handling: counts active bookings for exact session slot (`sessionKey` + exact `startAt`/`endAt`) and blocks when full.
- Member priority rule: users with role `MEMBER` can book 24 hours earlier than non-members.
  - Configurable via `BOOKING_OPEN_HOURS_NON_MEMBER` and `BOOKING_MEMBER_EARLY_ACCESS_HOURS`.

## Booking API (Part 2)

- Waitlist routes:
  - `POST /bookings/waitlist` (join queue)
  - `GET /bookings/waitlist?sessionKey=<key>&startAt=<iso>&endAt=<iso>`
- Auto-promotion triggers:
  - `POST /bookings/:bookingId/cancel` (cancels active booking and auto-promotes next waitlisted user)
  - `POST /bookings/promote-next` (admin-triggered promotion for seat opening/capacity or manual operations)
- FIFO scope used: queue per session-slot key (`sessionKey + startAt`) and ordered by `queuePosition`, then `createdAt`.
- Promotion rules:
  - next `WAITING` entry is considered first (strict FIFO)
  - booking window/member policy is re-evaluated before promotion
  - promotion creates a confirmed booking for the opened seat and marks waitlist entry as `CONVERTED`

## Booking API (Part 3)

- Reschedule route:
  - `POST /bookings/:bookingId/reschedule`
  - validates booking activity + actor authorization + target window/capacity/seat overlap using booking policy rules
  - when reschedule succeeds, the old slot vacancy triggers FIFO auto-promotion from waitlist
- Cancellation routes:
  - Preview: `GET /bookings/:bookingId/cancellation-preview?baseAmount=<optional>`
  - Confirm: `POST /bookings/:bookingId/cancel-confirm`
  - Backward-compatible alias: `POST /bookings/:bookingId/cancel`
- Cancellation fee policy (implemented exactly with explicit boundaries):
  - `> 24h` before start: `0%` fee
  - `<= 24h` and `>= 2h` before start: `50%` fee
  - `< 2h` before start: `100%` fee
