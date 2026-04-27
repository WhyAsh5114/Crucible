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

log "starting mcp-deployer on port ${DEPLOYER_MCP_PORT}"
bun run --cwd /app/packages/mcp-deployer start &
deployer_pid=$!

log "starting mcp-wallet on port ${WALLET_MCP_PORT}"
bun run --cwd /app/packages/mcp-wallet start &
wallet_pid=$!

log "starting mcp-memory on port ${MEMORY_MCP_PORT}"
bun run --cwd /app/packages/mcp-memory start &
memory_pid=$!

shutdown() {
    log "received shutdown — terminating services"
    kill -TERM "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
    wait "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

# If any service exits, propagate the failure to the container.
while true; do
    for pair in "chain_pid:mcp-chain" "compiler_pid:mcp-compiler" "deployer_pid:mcp-deployer" "wallet_pid:mcp-wallet" "memory_pid:mcp-memory"; do
        varname="${pair%%:*}"
        label="${pair##*:}"
        eval pid=\$$varname
        if ! kill -0 "${pid}" 2>/dev/null; then
            log "${label} exited unexpectedly" >&2
            kill -TERM "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
            wait "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" 2>/dev/null || true
            exit 1
        fi
    done
    sleep 2
done
