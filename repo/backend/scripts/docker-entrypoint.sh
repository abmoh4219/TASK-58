#!/bin/sh
set -eu

echo "[backend] Generating Prisma client"
npm run prisma:generate

echo "[backend] Applying migrations"
npm run prisma:migrate:deploy

if [ "${SEED:-0}" = "1" ] || [ "${SEED:-0}" = "true" ]; then
  echo "[backend] Running QA seed"
  npm run seed:qa
else
  echo "[backend] Skipping QA seed (SEED not enabled)"
fi

echo "[backend] Starting API"
node dist/server.js
