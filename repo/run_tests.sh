#!/bin/sh
set -eu

export DATABASE_URL="${DATABASE_URL:-postgresql://culinary_user:culinary_password@postgres:5432/culinary_studio?schema=public}"
export REAL_INTEGRATION_DATABASE_URL="${REAL_INTEGRATION_DATABASE_URL:-$DATABASE_URL}"
export REAL_INTEGRATION_BASE_URL="${REAL_INTEGRATION_BASE_URL:-http://127.0.0.1:4000}"
export RUN_REAL_INTEGRATION="true"
export REDIS_URL="${REDIS_URL:-redis://redis:6379}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-test_access_secret}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-test_refresh_secret}"

echo "[setup] Generating Prisma client for container runtime"
npm run prisma:generate --workspace backend

echo "[1/3] Backend unit tests"
npm run test:unit --workspace backend

echo "[2/3] Backend API tests"
npm run test:api --workspace backend

echo "[3/3] Frontend unit tests"
npm run test:unit --workspace frontend

echo "All test suites completed successfully."
echo "Summary: total=3 passed=3 failed=0"
