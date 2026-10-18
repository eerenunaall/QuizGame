#!/usr/bin/env bash
# Applies the migrations, optionally loads the development bank, then starts the server.
set -euo pipefail
cd /app

# Hosting platforms (Render) tell the service its own public address; the QR code and the allowed
# browser origin must be exactly that address.
if [ -z "${PUBLIC_WEB_URL:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export PUBLIC_WEB_URL="$RENDER_EXTERNAL_URL"
fi
if [ -z "${ALLOWED_ORIGINS:-}" ] && [ -n "${PUBLIC_WEB_URL:-}" ]; then
  export ALLOWED_ORIGINS="$PUBLIC_WEB_URL"
fi

pnpm --filter @quizparty/db run migrate

if [ "${QP_SEED_DEV:-0}" = "1" ]; then
  # Refused by the CLI when NODE_ENV=production: the development bank never reaches real players.
  pnpm --filter @quizparty/scripts run question seed --seed-file /app/seed/questions.tr.jsonl
fi

if [ "${QP_SEED_DEMO:-0}" = "1" ]; then
  # Temporary cult TV/film demo bank (seed/demo/README.md); same production refusal as above.
  # Optional extra: a problem here must not keep the demo from starting.
  for f in /app/seed/demo/questions.*.jsonl; do
    pnpm --filter @quizparty/scripts run question seed \
      --seed-file "$f" \
      --categories-file /app/seed/demo/categories.json || echo "demo bank $f not loaded (continuing)"
  done
fi

exec pnpm --filter @quizparty/realtime run start
