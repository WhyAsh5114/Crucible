#!/usr/bin/env bash
# ci-test.sh — Start an ephemeral Postgres, run migrations, run the test suite,
# then stop the container regardless of test outcome.
#
# When DATABASE_URL is already set (e.g. inside the devcontainer) we skip the
# Docker lifecycle and just run tests against the existing database.
set -euo pipefail

CONTAINER_NAME="crucible-ci-pg"
DB_URL="postgresql://postgres:postgres@localhost:5432/crucible"

cleanup() {
  if [[ "${STARTED_PG:-0}" == "1" ]]; then
    echo ">>> Stopping Postgres container…"
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo ">>> Starting ephemeral Postgres (postgres:17-alpine)…"
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker run -d --rm \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_DB=crucible \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -p 5432:5432 \
    postgres:17-alpine

  STARTED_PG=1
  export DATABASE_URL="$DB_URL"

  echo ">>> Waiting for Postgres to be ready…"
  until docker exec "$CONTAINER_NAME" pg_isready -U postgres -d crucible -q 2>/dev/null; do
    sleep 0.5
  done

  echo ">>> Running migrations…"
  (cd packages/backend && bunx prisma migrate deploy)
else
  echo ">>> DATABASE_URL already set — skipping Docker Postgres lifecycle"
fi

echo ">>> Running test suite…"
# turbo run test runs each package in its own directory, picking up the
# package-level bunfig.toml (including test/setup.ts preloads).
bun run test --force
