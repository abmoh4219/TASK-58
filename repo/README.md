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

Run the full QA stack with a single command:

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, backend, and frontend; backend startup automatically runs `prisma migrate deploy`, optional QA seed (enabled in `.env.qa`), and then serves traffic.

Access services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## QA Environment Wiring

QA uses only Docker Compose. Environment variables are wired through committed `.env.qa` via `env_file` in `docker-compose.yml`, so no manual `cp .env.example .env`, no local npm install, and no manual migration commands are required for the default review path.

## QA Login

- API base URL: `http://localhost:4000`
- Frontend URL: `http://localhost:5173`
- Admin login (username/email): `qa.admin@culinary.local`
- Admin password: `QaAdminPass123!`
- Member login (username/email): `qa.member@culinary.local`
- Member password: `QaMemberPass123!`
- Seed behavior: enabled by default with `SEED=1` in `.env.qa`; can be disabled by setting `SEED=0`.

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
- Notifications scenarios/preferences migration: `backend/prisma/migrations/20260329013000_notifications_scenarios_preferences/migration.sql`
- Webhook failure alerts/ack migration: `backend/prisma/migrations/20260329023000_webhook_failure_alerts_ack/migration.sql`
- Recipe analytics views/cuisines migration: `backend/prisma/migrations/20260329034500_recipe_analytics_views_and_cuisines/migration.sql`
- Recipe difficulty for analytics migration: `backend/prisma/migrations/20260329043000_recipe_difficulty_for_analytics/migration.sql`
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

## Notifications (Part 1)

- Supported notification scenarios:
  - `BOOKING_SUCCESS`
  - `SCHEDULE_CHANGE`
  - `CANCELLATION`
  - `WAITLIST_PROMOTION`
  - `CLASS_REMINDER`
- Mute controls scope:
  - per-user global mute (`globalMuted`)
  - per-user category mute list (`mutedCategories[]`)
- Notification APIs:
  - `POST /notifications/events` (create scenario event + queue/deliver flow)
  - `POST /notifications/dispatch-due` (admin-triggered delivery of queued due notifications)
  - `GET /notifications/history` (durable history query)
  - `GET /notifications/preferences`
  - `PUT /notifications/preferences`
- Booking integration hooks (automatic creates):
  - booking success
  - schedule change (reschedule)
  - cancellation
  - waitlist promotion
  - class reminder scheduling endpoint: `POST /bookings/:bookingId/reminders`

## Webhooks (Part 2)

- Local integration/configuration APIs:
  - `GET /webhooks/configs`
  - `POST /webhooks/configs`
  - `PUT /webhooks/configs/:configId`
  - `POST /webhooks/emit` (generic event outbox enqueue)
  - `POST /webhooks/dispatch-due` (process due queue)
  - `GET /webhooks/logs`
- Local development subscriber URL support:
  - local URLs (`localhost`, `127.0.0.1`, `host.docker.internal`, `*.local`) are allowed when `WEBHOOK_ALLOW_LOCAL_TARGETS=true`.
  - non-local targets must use HTTPS.
- Outbound HMAC signing:
  - algorithm: `HMAC-SHA256`
  - signed string: `${timestamp}.${rawJsonBody}`
  - headers:
    - `x-webhook-id`
    - `x-webhook-event`
    - `x-webhook-timestamp`
    - `x-webhook-signature` (`sha256=<hex>`)
    - `x-webhook-signature-version` (`v1`)
    - `x-webhook-key-id`
  - receiver clock/skew notes are documented inline in webhook sender code.
- Retry + dead-letter behavior:
  - transient failures (`network`, `408`, `429`, `5xx`) retry with exponential backoff (`WEBHOOK_RETRY_BASE_SECONDS`, `WEBHOOK_RETRY_MAX_SECONDS`) up to config `maxRetries`.
  - permanent failures (`4xx`) or exhausted retries are marked `DEAD_LETTER` in `WebhookLog`.
- Dispatch wiring:
  - booking/waitlist events enqueue webhook outbox records.
  - generic outbox pattern is also available via `POST /webhooks/emit` for other flows.

## Notifications/Webhooks Ops (Part 3)

- Failure alert generation behavior:
  - open admin alert when a delivery becomes `DEAD_LETTER`.
  - open admin alert when retry attempts reach threshold (`WEBHOOK_FAILURE_ALERT_THRESHOLD_ATTEMPTS`, default `3`).
  - if an open alert already exists for the same webhook config + event key, it is updated (failure count/time), not duplicated.
- Visible failure tracking:
  - persistent `WebhookFailureAlert` records remain `OPEN` until acknowledged.
  - admin notification entries are generated for new open alerts (`NotificationScenario.WEBHOOK_FAILURE`).
- Admin APIs:
  - `GET /webhooks/failure-alerts` (filter by status/config/event/time)
  - `POST /webhooks/failure-alerts/:alertId/ack`

## Analytics (Part 1)

- Source definitions:
  - Recipe view volume source: durable `RecipeViewEvent` rows (`POST /analytics/recipes/:recipeId/views`).
  - Cuisine interest source: recipe-view events weighted by `Recipe.cuisineTags`.
- APIs:
  - `POST /analytics/recipes/:recipeId/views`
  - `GET /analytics/recipes/view-volume?from=<iso>&to=<iso>&limit=<int>`
  - `GET /analytics/recipes/cuisine-interest?from=<iso>&to=<iso>&limit=<int>`
- Date range and timezone policy:
  - `from`/`to` are interpreted as UTC instants.
  - Drill-down daily buckets are grouped by UTC calendar day.
  - If omitted, range defaults to last 30 days ending at now.
- Cuisine distribution dimension:
  - view-weighted by recipe tags.
  - a view contributes total weight 1 split equally across all tags on that recipe.
  - recipes without tags contribute to `uncategorized`.

## Analytics (Part 2)

- Weekly consistency streaks endpoint:
  - `GET /analytics/workflows/weekly-streaks?from=<iso>&to=<iso>&userId=<optional>`
  - Streak rule: at least one `COMPLETED` workflow run in a UTC calendar week.
- Difficulty progression endpoint:
  - `GET /analytics/workflows/difficulty-progression?from=<iso>&to=<iso>&userId=<optional>`
  - Uses recipe difficulty metadata from completed workflow runs.
  - Score mapping: `EASY=1`, `MEDIUM=2`, `HARD=3`, `EXPERT=4`.
- Completion accuracy endpoint:
  - `GET /analytics/workflows/completion-accuracy?from=<iso>&to=<iso>&userId=<optional>`
  - Breakdown source: workflow event records (`STEP_COMPLETED`, `STEP_SKIPPED`, `STEP_ROLLBACK`).
- Date range contract:
  - Same as part 1: UTC instants for `from`/`to`; UTC daily/weekly drill-down buckets.

## Analytics (Part 3)

- Permissioned CSV export endpoint:
  - `GET /analytics/exports/:dataset.csv?from=<iso>&to=<iso>&userId=<optional>`
  - authorized role: `ADMIN`
- Local file behavior chosen:
  - API returns CSV as attachment download (`Content-Disposition`) and streams response from server memory stream.
  - no direct write to arbitrary local filesystem paths.
- Export audit:
  - each export writes an `AuditLog` record with action `EXPORT`, dataset, range, user scope, format, and row count.
- Exportable datasets (composed from 8.1–8.2):
  - `recipe_view_volume` columns:
    - `recipe_id, recipe_code, recipe_name, cuisine_tags, views, unique_users, unique_sessions`
  - `cuisine_interest` columns:
    - `cuisine_tag, weighted_views, percentage`
  - `weekly_streaks` columns:
    - `week_start_utc, has_completion`
  - `difficulty_progression` columns:
    - `day_utc, completed_runs, avg_difficulty_score, primary_difficulty, easy_count, medium_count, hard_count, expert_count`
  - `completion_accuracy` columns:
    - `day_utc, completed, skipped, rolled_back, completed_pct, skipped_pct, rolled_back_pct`
