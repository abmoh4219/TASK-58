# System Design

## Architecture Overview

The platform is a monorepo with three runtime tiers:

- `frontend/` SvelteKit web app (role-based workspaces)
- `backend/` Fastify API (`/api/v1/*`)
- Data services: PostgreSQL (system of record) and Redis (rate-limit/signed-request/idempotency helpers where needed)

Deployment for QA/dev is containerized with Docker Compose and a single startup command (`docker compose up --build`).

## High-Level Component Model

```text
Browser (SvelteKit UI)
  -> HttpOnly JWT cookie auth
  -> REST API calls (/api/v1/*)

Fastify API (module routers)
  -> auth + role guards
  -> security middleware (rate limit, signed requests, idempotency)
  -> domain services (bookings, billing, workflows, notifications, webhooks, analytics)
  -> Prisma

PostgreSQL
  -> transactional state, audit/event rows, immutable invoice snapshots

Redis
  -> runtime support for selected middleware/integration behaviors
```

## Backend Module Boundaries

- `auth`: registration/login/logout/me; JWT cookie lifecycle; role gates.
- `security`: signed request verification, replay protection, idempotency-key handling, user/IP rate limiting.
- `bookings`: availability, create booking, waitlist join/view/promote, reschedule, cancellation preview/confirm, reminders.
- `billing`: effective price-book lookup, membership/credit pack pricing and purchases, wallet/credits, invoice issuance/outstanding, manual payments.
- `workflows`: recipe timeline materialization, workflow runs, timer tick/pause/resume, complete/skip/rollback, workflow event feed.
- `notifications`: event creation, scheduled dispatch, history, user preference muting.
- `webhooks`: config management, event outbox emit, dispatch worker trigger, log queries, failure-alert acknowledgment.
- `analytics`: recipe/workflow analytics with UTC-based date bucketing and permissioned CSV export.

## Security Model

### Authentication and Authorization

- Auth uses JWT in HttpOnly cookie (`access_token`).
- Route-level access is enforced with:
  - `requireAuth` (must be authenticated)
  - `requireRoles([...])` (must include one of allowed roles)

### Request Protection Layers

- User/IP rate limiting (global pre-handler)
- Signed-request verification for protected mutation paths (`/bookings`, `/billing`, `/invoices`, `/payments`)
  - headers: `X-Key-Id`, `X-Timestamp`, `X-Nonce`, `X-Signature`
  - replay prevention with nonce persistence window
- Idempotency for protected mutations via `Idempotency-Key`
  - request fingerprint stored
  - replay returns cached result or conflict

### Financial Integrity

- Invoices are immutable after issuance.
- Discounts above policy require admin role and reason.
- Payments append new rows; invoice line/totals are not overwritten.

## Main Workflows

### 1) Member Booking and Waitlist

1. Client queries `GET /bookings/availability`.
2. Client posts `POST /bookings` if capacity is open.
3. If full, client posts `POST /bookings/waitlist`.
4. On cancellation or admin promotion, backend promotes FIFO waitlist entry where eligible.
5. Notifications + webhooks are emitted for booking/cancellation/promotion events.

### 2) Billing and Payment

1. Client resolves effective pricing by date/currency.
2. Invoice is issued (`POST /billing/invoices/issue`) with resolved line snapshots.
3. Outstanding is tracked through `GET /billing/invoices/:id/outstanding`.
4. Admin records manual tender (`POST /billing/payments/manual`).

### 3) Workflow Execution (Recipe Player)

1. Materialize timeline from recipe steps/phases.
2. Create run (`POST /workflows/runs`).
3. Drive run with pause/resume/tick and step complete/skip/rollback endpoints.
4. Persist workflow run events for analytics/audit views.

### 4) Webhook Reliability and Operations

1. Domain events enqueue webhook logs.
2. Dispatcher sends due logs with retry/backoff.
3. Dead-letter/threshold failures produce failure alerts.
4. Admin queries logs/alerts and acknowledges alerts.

### 5) Analytics and Export

1. Track recipe views via analytics event endpoint.
2. Read aggregates (view volume, cuisine interest, weekly streaks, difficulty progression, completion accuracy).
3. Admin exports CSV from permissioned endpoint; export is audited.

## Data Flow Notes

- Date-range analytics use UTC instants and UTC bucket boundaries.
- Booking capacity checks and seat overlap are validated before commit, with DB safeguards and transactional locks.
- Notification/webhook dispatch pipelines are asynchronous but persisted.
- Workflow transitions are durable; run-step state is source of truth for in-progress playback.

## Frontend Workspace Model

Workspace routing is role-gated server-side in SvelteKit route groups:

- Member workspace (`/member`) for bookings and recipe player.
- Instructor workspace (`/instructor`) for class run controls and monitoring.
- Front desk workspace (`/front-desk`) for booking/waitlist/payment operations.
- Admin workspace (`/admin`) for governance and operations.
- Dashboard (`/dashboard`) for analytics visualization + CSV exports.

All workspaces consume real backend APIs; no mock business data is used for these surfaces.
