#!/usr/bin/env bash
# Starts PostgreSQL (and optionally Redis) for local development and creates the dev role/databases.
# Works in the cloud sandbox (Debian/Ubuntu packages, run as root) and on machines with a local
# PostgreSQL. Use infra/deployment/docker-compose.yml where Docker is available.
set -euo pipefail

PG_VERSION="${PG_VERSION:-16}"
DB_USER="${DB_USER:-quizparty}"
DB_PASSWORD="${DB_PASSWORD:-quizparty}"
DB_NAME="${DB_NAME:-quizparty_dev}"

if command -v pg_lsclusters >/dev/null 2>&1; then
  if ! pg_lsclusters | grep -q " online "; then
    pg_ctlcluster "$PG_VERSION" main start
    for _ in $(seq 1 20); do
      pg_lsclusters | grep -q " online " && break
      sleep 0.5
    done
  fi
fi

run_psql() {
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tA "$@"
  else
    psql -v ON_ERROR_STOP=1 -tA "$@"
  fi
}

if [ "$(run_psql -c "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" != "1" ]; then
  run_psql -c "CREATE ROLE ${DB_USER} LOGIN CREATEDB PASSWORD '${DB_PASSWORD}'"
fi
if [ "$(run_psql -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" != "1" ]; then
  run_psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
fi
run_psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null

if command -v redis-server >/dev/null 2>&1 && ! (command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1); then
  redis-server --daemonize yes >/dev/null 2>&1 || true
fi

echo "postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
