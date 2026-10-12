#!/usr/bin/env bash
# Applies the migrations, optionally loads the development bank, then starts the server.
set -euo pipefail
cd /app

pnpm --filter @quizparty/db run migrate

if [ "${QP_SEED_DEV:-0}" = "1" ]; then
  # Refused by the CLI when NODE_ENV=production: the development bank never reaches real players.
  pnpm --filter @quizparty/scripts run question seed --seed-file /app/seed/questions.tr.jsonl
fi

exec pnpm --filter @quizparty/realtime run start
