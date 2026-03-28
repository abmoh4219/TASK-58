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
- Billing membership/credits migration: `backend/prisma/migrations/20260328203000_billing_membership_credits_wallet_pricing/migration.sql`
- Workflow recipe cue migration: `backend/prisma/migrations/20260328214500_workflow_recipe_cues/migration.sql`
- Workflow run timers/pause migration: `backend/prisma/migrations/20260328230000_workflow_run_timers_pause_resume/migration.sql`
- Workflow run events/rollback migration: `backend/prisma/migrations/20260329000000_workflow_run_events_rollback/migration.sql`
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

## Billing API (Part 1)

- Price books and effective pricing:
  - `GET /billing/price-books/effective?asOf=<iso>&currency=<ISO3>`
  - `GET /billing/membership-plans/:membershipPlanId/price?asOf=<iso>&currency=<ISO3>`
  - `GET /billing/credit-packs/:creditPackId/price?asOf=<iso>&currency=<ISO3>`
- Membership billing (schedule/charge snapshots):
  - `POST /billing/memberships/enroll`
  - `POST /billing/memberships/:enrollmentId/renew`
  - Enrollment stores `startsAt`, `endsAt`, optional `nextBillingAt`, `lastChargedAt`, and pricebook snapshot references.
- Credit packs with expiry:
  - `POST /billing/credit-packs/purchase`
  - Creates `CreditPackGrant` with `creditsTotal`, `creditsRemaining`, and calculated `expiresAt`.
- Credits and wallet:
  - `GET /billing/credits/balance`
  - `POST /billing/credits/consume`
  - `GET /billing/wallet?currency=<ISO3>`
  - `POST /billing/wallet/top-up` (ADMIN)
  - `POST /billing/wallet/debit` (ADMIN)

## Billing API (Part 2)

- Invoice issuance endpoints:
  - `POST /billing/invoices/issue`
  - `GET /billing/invoices/:invoiceId`
- Invoice immutability approach:
  - Issuance creates invoices in `ISSUED` status immediately.
  - Existing DB triggers block mutations once invoice is non-draft.
  - API exposes no invoice update endpoint.
  - Corrections are handled by issuing new corrective documents (existing invoice is never edited).
- Tax policy:
  - Default sales tax rate is `8.875%` (`SALES_TAX_RATE=0.08875`), configurable via env.
- Discount policy:
  - Invoice discount cap is `30%` for normal users.
  - Above `30%` requires `ADMIN` role and mandatory `discountReason`.
  - Discount reason is stored through `DiscountOverride` linked to invoice.
- Pricing source at invoice time:
  - Line prices resolve from effective published price book (`validFrom/validTo`) at invoice `asOf` datetime.
  - Invoice line snapshots store resolved price book code/version and resolved line amounts/tax values.

## Billing API (Part 3)

- Manual tender endpoints:
  - `POST /billing/payments/manual` (ADMIN)
  - Supported methods: `CASH`, `CHECK`, `MANUAL_CARD`
  - No processor integration; payment recording is fully manual.
- Outstanding and due-date endpoints:
  - `GET /billing/invoices/:invoiceId/outstanding`
  - `GET /billing/receivables?userId=<optional-admin-scope>`
- Payment application behavior:
  - Payment is inserted as a new `Payment` row linked to invoice.
  - Outstanding is computed from `invoice.totalAmountSnapshot - SUM(completed payments)`.
  - Issued invoice amounts/lines are not edited, preserving invoice immutability.
- Due dates:
  - Invoice due date can be set on issuance (`dueAt`); if omitted, defaults from `INVOICE_DUE_DAYS` (default 14).

## Workflow Engine (Part 1)

- Materialization endpoints:
  - `GET /workflows/recipes/:recipeId/timeline?version=<optional-int>`
  - `POST /workflows/recipes/:recipeId/materialize`
- Source model:
  - Uses `Recipe` + `RecipeStep` data.
  - `phaseNumber` controls sequential phase order.
  - Steps inside the same phase are materialized as parallel branches.
- Unified timeline representation:
  - single `timeline.segments[]` structure with ordered phase segments
  - each segment contains parallel `branches[]`
  - each branch contains ordered `nodes[]` of type `STEP` and optional `WAIT`
- Wait-state behavior:
  - `waitSeconds` becomes a `WAIT` node after step execution.
  - if `isBlocking=false`, wait node is represented but does not delay next phase.
- Temperature / heat cues:
  - `RecipeStep.cueText`, `RecipeStep.targetTempC`, `RecipeStep.heatLevel` are included in node cues.

## Workflow Engine (Part 2)

- Workflow run state endpoints:
  - `POST /workflows/runs`
  - `GET /workflows/runs/active`
  - `GET /workflows/runs/:runId`
  - `POST /workflows/runs/:runId/pause`
  - `POST /workflows/runs/:runId/resume`
  - `POST /workflows/runs/:runId/tick`
  - `POST /workflows/runs/:runId/steps/:runStepId/complete`
  - `POST /workflows/runs/:runId/steps/:runStepId/skip`
- Durable run-state model:
  - `WorkflowRun` is linked to operator user, recipe, optional booking.
  - `WorkflowRunStep` stores per-step status and timing fields including `timerTargetAt` and `pausedRemainingSeconds`.
- Automatic timer transitions:
  - timed steps persist `timerTargetAt`; `/tick` advances due steps and phase transitions.
- Pause/resume behavior:
  - pause captures remaining seconds per running step.
  - resume restores timers without losing step/phase position.
- Completion/skip durability:
  - steps are marked `COMPLETED` or `SKIPPED` in persistent run-step records.

## Workflow Engine (Part 3)

- Rollback endpoint:
  - `POST /workflows/runs/:runId/steps/:runStepId/rollback`
- Rollback rule implemented:
  - target step must be previously `COMPLETED`
  - target step is restored to active execution position
  - subsequent progressed steps (completed/skipped/running/ready after target order) are invalidated back to `PENDING`
  - run status is restored to `RUNNING` and prior `completedAt` is cleared
- Event persistence for analytics (append-only):
  - `WorkflowRunEvent` table stores `STEP_COMPLETED`, `STEP_SKIPPED`, `STEP_ROLLBACK`
  - events include run/step/user links, event type, JSON payload, and timestamp
- Analytics read endpoint:
  - `GET /workflows/events?runId=&userId=&stepId=&types=&from=&to=&limit=`
  - supports filtering by user, run, time window, step, and event type list
