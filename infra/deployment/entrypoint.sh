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

# Production never loads development or demo banks, whatever the flags say (ADR-0014): the CLI would refuse
# them anyway, and refusing quietly here keeps a mistaken flag from crash-looping the venue's service.
if [ "${NODE_ENV:-development}" = "production" ]; then
  if [ "${QP_SEED_DEV:-0}" = "1" ] || [ "${QP_SEED_DEMO:-0}" = "1" ]; then
    echo "entrypoint: NODE_ENV=production, ignoring QP_SEED_DEV / QP_SEED_DEMO"
  fi
  QP_SEED_DEV=0
  QP_SEED_DEMO=0
fi

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

# A verified bank (docs/GUSTO_GO_LIVE.md): QP_BANK_DIR=/app/seed/gusto. Works in production. Problem rows are
# printed in the log and skipped; only a crash of the loader itself stops the start.
if [ -n "${QP_BANK_DIR:-}" ]; then
  bash /app/infra/deployment/load-bank.sh "$QP_BANK_DIR"
fi

exec pnpm --filter @quizparty/realtime run start
