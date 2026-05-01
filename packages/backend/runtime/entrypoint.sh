#!/usr/bin/env bash
# Per-workspace runtime entrypoint.
#
# Boots all MCP services and supervises them with per-service restart on crash.
# The container stays alive until it receives SIGTERM/SIGINT.

set -uo pipefail

cd /workspace

# Make sure the workspace mount has the layout the agents expect.
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

# ── Per-service supervised launcher ──────────────────────────────────────────
#
# Runs a service in a background restart loop. On crash it waits 1s then
# restarts up to MAX_RESTARTS times before giving up and exiting the container.
# On clean shutdown (SIGTERM to the loop process) the loop exits without
# restarting.

MAX_RESTARTS=5

supervise() {
    local label="$1"
    local pkg="$2"
    local restarts=0
    local stopping=0

    # Allow the supervisor loop to be cleanly stopped.
    trap 'stopping=1' TERM INT

    while true; do
        bun run --cwd "/app/packages/${pkg}" start &
        local pid=$!

        # Wait for the child; ignore errors from wait itself (EINTR on signal).
        wait "${pid}" 2>/dev/null || true
        local exit_code=$?

        if [[ "${stopping}" -eq 1 ]]; then
            break
        fi

        restarts=$(( restarts + 1 ))
        if [[ "${restarts}" -gt "${MAX_RESTARTS}" ]]; then
            log "${label} crashed ${MAX_RESTARTS} times — giving up" >&2
            emit_container_event "service_fatal" "${label} exceeded max restarts"
            exit 1
        fi

        log "${label} exited (code ${exit_code}) — restart ${restarts}/${MAX_RESTARTS}"
        emit_container_event "service_restart" "${label} restarting (attempt ${restarts})"
        sleep 1
    done
}

# ── Boot all services ─────────────────────────────────────────────────────────

log "starting mcp-devtools on port ${DEVTOOLS_MCP_PORT}"
supervise mcp-devtools mcp-devtools &
devtools_pid=$!

log "starting mcp-chain on port ${CHAIN_MCP_PORT}"
supervise mcp-chain mcp-chain &
chain_pid=$!

log "starting mcp-compiler on port ${COMPILER_MCP_PORT}"
supervise mcp-compiler mcp-compiler &
compiler_pid=$!

log "starting mcp-deployer on port ${DEPLOYER_MCP_PORT}"
supervise mcp-deployer mcp-deployer &
deployer_pid=$!

log "starting mcp-wallet on port ${WALLET_MCP_PORT}"
supervise mcp-wallet mcp-wallet &
wallet_pid=$!

log "starting mcp-memory on port ${MEMORY_MCP_PORT}"
supervise mcp-memory mcp-memory &
memory_pid=$!

log "starting mcp-terminal on port ${TERMINAL_MCP_PORT}"
supervise mcp-terminal mcp-terminal &
terminal_pid=$!

emit_container_event "runtime_start" "services booted"

shutdown() {
    log "received shutdown — terminating supervisors"
    emit_container_event "runtime_shutdown" "received shutdown signal"
    kill -TERM "${devtools_pid}" "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" "${terminal_pid}" 2>/dev/null || true
    wait "${devtools_pid}" "${chain_pid}" "${compiler_pid}" "${deployer_pid}" "${wallet_pid}" "${memory_pid}" "${terminal_pid}" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

# Stay alive while at least one supervisor is running.
wait
