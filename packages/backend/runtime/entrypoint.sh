#!/usr/bin/env bash
# Per-workspace runtime entrypoint.
#
# Boots mcp-chain and mcp-compiler in parallel, restarts either on crash, and
# exits cleanly when the container is stopped.

set -euo pipefail

cd /workspace

# Make sure the workspace mount has the layout the agents expect. Crucible's
# control plane usually pre-creates these from the host side, but a runner that
# starts on an empty volume should still come up healthy.
mkdir -p contracts frontend .crucible/artifacts .crucible/logs

log() { echo "[runtime] $*"; }

# Run both servers as background jobs so we can supervise them. We rely on
# Bun's hot-restart-free `start` script in each package.
log "starting mcp-chain on port ${CHAIN_MCP_PORT}"
bun run --cwd /app/packages/mcp-chain start &
chain_pid=$!

log "starting mcp-compiler on port ${COMPILER_MCP_PORT}"
bun run --cwd /app/packages/mcp-compiler start &
compiler_pid=$!

shutdown() {
    log "received shutdown — terminating services"
    kill -TERM "${chain_pid}" "${compiler_pid}" 2>/dev/null || true
    wait "${chain_pid}" "${compiler_pid}" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

# If either service exits, propagate the failure to the container.
while true; do
    if ! kill -0 "${chain_pid}" 2>/dev/null; then
        log "mcp-chain exited unexpectedly" >&2
        kill -TERM "${compiler_pid}" 2>/dev/null || true
        wait "${compiler_pid}" 2>/dev/null || true
        exit 1
    fi
    if ! kill -0 "${compiler_pid}" 2>/dev/null; then
        log "mcp-compiler exited unexpectedly" >&2
        kill -TERM "${chain_pid}" 2>/dev/null || true
        wait "${chain_pid}" 2>/dev/null || true
        exit 1
    fi
    sleep 2
done
