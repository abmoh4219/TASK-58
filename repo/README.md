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
- Intentionally excluded: business logic, API endpoints, UI pages.
