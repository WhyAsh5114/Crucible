#!/usr/bin/env bash
# ci-test.sh — Run migrations then run the test suite against the devcontainer
# Postgres (postgresql://postgres:postgres@localhost:5432/crucible).
#
# Override DATABASE_URL if your Postgres is on a different host/port.
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/crucible}"

echo ">>> Running migrations…"
(cd packages/backend && bunx prisma migrate deploy)

echo ">>> Running test suite…"
# turbo run test runs each package in its own directory, picking up the
# package-level bunfig.toml (including test/setup.ts preloads).
bun run test --force
