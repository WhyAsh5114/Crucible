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

emit_container_event() {
    local subtype="$1"
    local message="$2"
    local ts
    ts=$(date +%s%3N)
    local payload
    payload=$(printf '{"type":"container","ts":%s,"subtype":"%s","message":"%s"}' "$ts" "$subtype" "$message")
    curl -sS -X POST "http://127.0.0.1:${DEVTOOLS_MCP_PORT}/event" \
        -H 'content-type: application/json' \
        -d "$payload" >/dev/null 2>&1 || true
}

log "starting mcp-devtools on port ${DEVTOOLS_MCP_PORT}"
bun run --cwd /app/packages/mcp-devtools start &
devtools_pid=$!

# Run both servers as background jobs so we can supervise them. We rely on
# Bun's hot-restart-free `start` script in each package.
log "starting mcp-chain on port ${CHAIN_MCP_PORT}"
bun run --cwd /app/packages/mcp-chain start &
chain_pid=$!

log "starting mcp-compiler on port ${COMPILER_MCP_PORT}"
bun run --cwd /app/packages/mcp-compiler start &
compiler_pid=$!

log "starting mcp-deployer on port ${DEPLOYER_MCP_PORT}"
bun run --cwd /app/packages/mcp-deployer start &
deployer_pid=$!

log "starting mcp-wallet on port ${WALLET_MCP_PORT}"
bun run --cwd /app/packages/mcp-wallet start &
wallet_pid=$!

log "starting mcp-memory on port ${MEMORY_MCP_PORT}"
bun run --cwd /app/packages/mcp-memory start &
memory_pid=$!
emit_container_event "runtime_start" "services booted"

shutdown() {
    log "received shutdown — terminating services"
    emit_container_event "runtime_shutdown" "received shutdown signal"
    kill -TERM "${devtools_pid}" "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
    wait "${devtools_pid}" "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

# If any service exits, propagate the failure to the container.
while true; do
    for pair in "devtools_pid:mcp-devtools" "chain_pid:mcp-chain" "compiler_pid:mcp-compiler" "deployer_pid:mcp-deployer" "wallet_pid:mcp-wallet" "memory_pid:mcp-memory"; do
        varname="${pair%%:*}"
        label="${pair##*:}"
        eval pid=\$$varname
        if ! kill -0 "${pid}" 2>/dev/null; then
            log "${label} exited unexpectedly" >&2
            emit_container_event "service_crash" "${label} exited unexpectedly"
            kill -TERM "${devtools_pid}" "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
            wait "${devtools_pid}" "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
            exit 1
        fi
    done
    sleep 2
done
