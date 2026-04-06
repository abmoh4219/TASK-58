# Culinary Studio Platform

No `.env` files are used or permitted in this project. All configuration must be provided via environment variables injected at runtime (shell, Docker, cloud hosting platform, etc.). See the config section for the complete list of required variables.

## Architecture Overview

- `backend/`: Fastify + Prisma API for auth, bookings/waitlist, billing, workflows, notifications, webhooks, and analytics.
- `frontend/`: SvelteKit workspace UI for member, instructor, front-desk, admin, and analytics operations.
- `backend/src/lib/config.ts`: single runtime config entrypoint backed by `process.env` only.
- `docker-compose.yml`: local multi-container stack (Postgres, Redis, backend, frontend, test runner, optional TLS proxy profile).

## Runtime Configuration (process.env only)

Required in production:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `SIGNED_REQUEST_SECRET`
- `FIELD_ENCRYPTION_KEY` (32-byte key material)

Commonly configured:

- `NODE_ENV` (`development|test|production`)
- `REDIS_URL`
- `BACKEND_HOST`, `BACKEND_PORT`
- `PUBLIC_API_BASE_URL`, `API_INTERNAL_BASE_URL`
- `CORS_ORIGIN` (comma-separated allowlist, HTTPS origins)
- `AUTH_COOKIE_SECURE` (defaults `true`)
- `TRUST_PROXY` (defaults enabled)
- `SIGNED_REQUEST_KEY_ID`
- `SECURITY_ACTION_PATH_PREFIXES`
- `AUTH_LOCK_MAX_ATTEMPTS`, `AUTH_LOCK_DURATION_MINUTES`
- `RATE_LIMIT_MAX_REQUESTS_PER_MINUTE`
- `BOOKING_OPEN_HOURS_NON_MEMBER`, `BOOKING_MEMBER_EARLY_ACCESS_HOURS`
- `SALES_TAX_RATE`, `INVOICE_DUE_DAYS`

## Local Development (No Docker)

1) Install dependencies:

```bash
npm ci
```

2) Export required variables in your shell:

```bash
export DATABASE_URL='postgresql://culinary_user:culinary_password@localhost:5432/culinary_studio?schema=public'
export REDIS_URL='redis://localhost:6379'
export JWT_ACCESS_SECRET='local_access_secret_change_me'
export JWT_REFRESH_SECRET='local_refresh_secret_change_me'
export SIGNED_REQUEST_SECRET='local_signed_request_secret_change_me'
export SIGNED_REQUEST_KEY_ID='default'
export FIELD_ENCRYPTION_KEY='0123456789abcdef0123456789abcdef'
export PUBLIC_API_BASE_URL='https://localhost:4000/api/v1'
export API_INTERNAL_BASE_URL='http://localhost:4000/api/v1'
export CORS_ORIGIN='https://localhost:5173'
export AUTH_COOKIE_SECURE='true'
```

3) Generate Prisma client and run migrations:

```bash
npm run --workspace backend prisma:generate
npm run --workspace backend prisma:migrate:deploy
```

4) Start backend and frontend:

```bash
npm run --workspace backend dev
npm run --workspace frontend dev
```

## Docker Run

Inject environment variables from your shell/CI/host and run:

```bash
docker compose build --no-cache
docker compose up -d
```

TLS is enabled by default via Caddy reverse proxy. All traffic on ports 80/443 is TLS-terminated.
Backend and frontend ports are not exposed to the host; traffic routes through Caddy only.

For development without TLS (not recommended for production):

```bash
docker compose --profile dev up -d
```

TLS notes:

- TLS is enforced by default on all LAN deployments.
- Public/browser URLs should use HTTPS origins only.
- Auth cookies are secure + httpOnly + sameSite=strict by default.
- Signed/idempotent protected mutations are user-scoped and validated after JWT auth.

## API Usage Examples

Login:

```bash
curl -k -X POST https://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"qa.admin@culinary.local","password":"QaAdminPass123!"}'
```

Protected signed mutation (`/bookings/waitlist`) expects:

- Cookie-based JWT (`access_token`)
- `x-key-id`, `x-timestamp`, `x-nonce`, `x-signature`
- `idempotency-key`
- Canonical signing payload: `METHOD\nPATH\nTIMESTAMP\nNONCE\nUSER_SUB\nSHA256(JSON_BODY)`

## Test Matrix

- Backend unit: `npm run --workspace backend test:unit`
- API integration: `npm run --workspace backend test:api`
- Full scripted matrix: `./run_tests.sh`
- Real integration/API flow (requires live DB/Redis/backend): `API_tests/api.integration.real.test.ts`
- Manual verification checklist: `docs/manual-verification-checklist.md`

## Seeded Credentials

- Admin: `qa.admin@culinary.local` / `QaAdminPass123!`
- Member: `qa.member@culinary.local` / `QaMemberPass123!`
