#!/usr/bin/env bash
# seed-memories.sh — Inject demo memory patterns into running Crucible containers.
#
# Each container only writes LOCAL patterns. The backend's
# /workspace/{id}/memory/patterns endpoint automatically surfaces every OTHER
# workspace's locals as scope='mesh', so peer patterns appear in the memory
# pane without any cross-writes.
#
# Graph edges in the memory pane are drawn between patterns with the same
# revertSignature, so this script seeds 2 variants per signature per container
# to give a clearly clustered graph.
#
# Seeded distribution (8 LOCAL patterns total, 4 per container):
#   Container A: STF ×2, EXPIRED ×2
#   Container B: ERC20:allowance ×2, OTC:filled ×2
#
# In the frontend, each container's pane will then show:
#   - Its own 4 patterns as "local"
#   - The other container's 4 patterns as "mesh"
#
# Usage:
#   bash scripts/seed-memories.sh                # auto-discover containers
#   bash scripts/seed-memories.sh --clean        # purge first, then seed
#   bash scripts/seed-memories.sh ws-a ws-b      # specific container names
#   bash scripts/seed-memories.sh --clean ws-a ws-b

set -euo pipefail

MEMORY_PORT=3104
CURL_TIMEOUT=120  # 0G KV batcher.exec() is an on-chain tx — can take 30-90s

# ── Parse args ────────────────────────────────────────────────────────────────

CLEAN=0
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--clean" ]]; then
    CLEAN=1
  else
    POSITIONAL+=("$arg")
  fi
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"

# ── Discover containers (bash 3.2 compatible) ─────────────────────────────────

CONTAINERS=()
if [[ $# -ge 1 ]]; then
  CONTAINERS=("$@")
else
  while IFS= read -r line; do
    [[ -n "$line" ]] && CONTAINERS+=("$line")
  done < <(docker ps --filter 'name=crucible-ws-' --format '{{.Names}}' | sort)
fi

if [[ ${#CONTAINERS[@]} -eq 0 ]]; then
  echo "No running crucible-ws-* containers found." >&2
  exit 1
fi

A="${CONTAINERS[0]}"
B="${CONTAINERS[1]:-}"

echo "Containers:"
echo "  A = $A"
[[ -n "$B" ]] && echo "  B = $B"
echo ""

# ── Helpers ───────────────────────────────────────────────────────────────────

# purge_container <container> — wipes local + mesh patterns (2 on-chain txs).
purge_container() {
  local container="$1"
  echo "  Purging local…"
  docker exec "$container" sh -c \
    "curl -sf --max-time ${CURL_TIMEOUT} -X DELETE 'http://127.0.0.1:${MEMORY_PORT}/patterns?scope=local'" \
    2>/dev/null || echo "    → purge local FAILED (continuing)"
  echo "  Purging mesh…"
  docker exec "$container" sh -c \
    "curl -sf --max-time ${CURL_TIMEOUT} -X DELETE 'http://127.0.0.1:${MEMORY_PORT}/patterns?scope=mesh'" \
    2>/dev/null || echo "    → purge mesh FAILED (continuing)"
}

# remember <container> <revert_sig> <patch> <trace_ref> <receipt> <logfile>
# Always writes a LOCAL pattern. Pipes payload via stdin to avoid shell
# quoting problems with single quotes / brackets / em dashes in patches.
# Writes output to <logfile> so parallel invocations don't interleave.
remember() {
  local container="$1"
  local revert_sig="$2"
  local patch="$3"
  local trace_ref="$4"
  local receipt="$5"
  local logfile="$6"

  local payload
  payload="{\"revertSignature\":\"${revert_sig}\",\"patch\":\"${patch}\",\"traceRef\":\"${trace_ref}\",\"verificationReceipt\":\"${receipt}\"}"
  printf '  %s\n' "$revert_sig" >> "$logfile"

  local response
  response=$(printf '%s' "$payload" | docker exec -i "$container" sh -c \
    "curl -sf --max-time ${CURL_TIMEOUT} -X POST http://127.0.0.1:${MEMORY_PORT}/remember \
      -H 'Content-Type: application/json' \
      --data-binary @-" 2>/dev/null) || { printf '    → FAILED (service down or tx timeout after %ss)\n' "${CURL_TIMEOUT}" >> "$logfile"; return; }

  local id
  id=$(printf '%s' "$response" | sed 's/.*"id":"\([^"]*\)".*/\1/')
  printf '    → %s\n' "$id" >> "$logfile"
}

# Temp dir for per-job logs; cleaned up on exit.
SEED_TMPDIR=$(mktemp -d)
trap 'rm -rf "$SEED_TMPDIR"' EXIT

# ── Optional clean sweep ──────────────────────────────────────────────────────

if [[ $CLEAN -eq 1 ]]; then
  echo "=== Purging existing patterns before seed ==="
  echo "--- $A ---"
  purge_container "$A"
  if [[ -n "$B" ]]; then
    echo "--- $B ---"
    purge_container "$B"
  fi
  echo ""
fi

# ── Seed all patterns ────────────────────────────────────────────────────────
# Writes to the same 0G KV stream must be serial — the batcher uses
# Date.now() as the version and the KV node requires strictly increasing
# versions, so concurrent writes to the same stream all get the same
# timestamp and all but the first are rejected.
#
# We parallelise at the CONTAINER level: A's 4 writes and B's 4 writes
# run concurrently with each other, but the 4 writes within each container
# are sequential. This gives ~2x speedup with zero version conflicts.

echo "=== Seeding patterns (containers in parallel, serial within each) ==="
echo ""

seed_container_a() {
  local log="$1"
  remember "$A" \
    "TransferHelper::safeTransferFrom: STF" \
    "diff --git a/contracts/Swap.sol b/contracts/Swap.sol\n--- a/contracts/Swap.sol\n+++ b/contracts/Swap.sol\n@@ -12,6 +12,8 @@\n function swapExactTokensForTokens(...) {\n+  IERC20(tokenIn).approve(address(router), amountIn);\n   router.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline);\n }" \
    "trace://uniswap-v2-stf-001" \
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    "$log"
  remember "$A" \
    "TransferHelper::safeTransferFrom: STF" \
    "diff --git a/contracts/Router.sol b/contracts/Router.sol\n--- a/contracts/Router.sol\n+++ b/contracts/Router.sol\n@@ -31,5 +31,7 @@\n function _routeExact(address pool, address tokenIn, uint amount) internal {\n+  IERC20(tokenIn).approve(pool, amount);\n   IPool(pool).swap(tokenIn, amount, address(this));\n }" \
    "trace://router-stf-002" \
    "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1" \
    "$log"
  remember "$A" \
    "UniswapV2: EXPIRED" \
    "diff --git a/contracts/Swap.sol b/contracts/Swap.sol\n--- a/contracts/Swap.sol\n+++ b/contracts/Swap.sol\n@@ -8,1 +8,1 @@\n-  uint deadline = block.timestamp - 1;\n+  uint deadline = block.timestamp + 300;" \
    "trace://uniswap-v2-expired-003" \
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
    "$log"
  remember "$A" \
    "UniswapV2: EXPIRED" \
    "diff --git a/scripts/deploy.ts b/scripts/deploy.ts\n--- a/scripts/deploy.ts\n+++ b/scripts/deploy.ts\n@@ -14,3 +14,3 @@\n-  const deadline = 1700000000;\n+  const deadline = Math.floor(Date.now() / 1000) + 300;" \
    "trace://deploy-expired-004" \
    "0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2" \
    "$log"
}

seed_container_b() {
  local log="$1"
  remember "$B" \
    "ERC20: transfer amount exceeds allowance" \
    "diff --git a/contracts/Vault.sol b/contracts/Vault.sol\n--- a/contracts/Vault.sol\n+++ b/contracts/Vault.sol\n@@ -20,5 +20,6 @@\n function deposit(uint amount) external {\n+  token.approve(address(this), amount);\n   token.transferFrom(msg.sender, address(this), amount);\n }" \
    "trace://erc20-vault-005" \
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" \
    "$log"
  remember "$B" \
    "ERC20: transfer amount exceeds allowance" \
    "diff --git a/contracts/Staking.sol b/contracts/Staking.sol\n--- a/contracts/Staking.sol\n+++ b/contracts/Staking.sol\n@@ -45,5 +45,7 @@\n function stake(uint amount) external {\n+  stakingToken.approve(address(this), amount);\n   stakingToken.transferFrom(msg.sender, address(this), amount);\n }" \
    "trace://erc20-staking-006" \
    "0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3" \
    "$log"
  remember "$B" \
    "OTC: order already filled" \
    "diff --git a/contracts/OTC.sol b/contracts/OTC.sol\n--- a/contracts/OTC.sol\n+++ b/contracts/OTC.sol\n@@ -34,4 +34,7 @@\n function fill(Order calldata order) external {\n+  bytes32 orderHash = _hashOrder(order);\n+  require(!filledOrders[orderHash], 'OTC: order already filled');\n+  filledOrders[orderHash] = true;\n   _settle(order);\n }" \
    "trace://otc-single-007" \
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" \
    "$log"
  remember "$B" \
    "OTC: order already filled" \
    "diff --git a/contracts/MultiOTC.sol b/contracts/MultiOTC.sol\n--- a/contracts/MultiOTC.sol\n+++ b/contracts/MultiOTC.sol\n@@ -58,4 +58,8 @@\n function fillBatch(Order[] calldata orders) external {\n   for (uint i = 0; i < orders.length; i++) {\n+    bytes32 h = _hashOrder(orders[i]);\n+    require(!filledOrders[h], 'OTC: order already filled');\n+    filledOrders[h] = true;\n     _settle(orders[i]);\n }" \
    "trace://otc-batch-008" \
    "0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4" \
    "$log"
}

LOG_A="$SEED_TMPDIR/a.log"
LOG_B="$SEED_TMPDIR/b.log"

seed_container_a "$LOG_A" &
PID_A=$!

if [[ -n "$B" ]]; then
  seed_container_b "$LOG_B" &
  PID_B=$!
fi

wait "$PID_A" || true
[[ -n "$B" ]] && wait "$PID_B" || true

echo "=== $A: local patterns ==="
[[ -f "$LOG_A" ]] && cat "$LOG_A"

if [[ -n "$B" ]]; then
  echo ""
  echo "=== $B: local patterns ==="
  [[ -f "$LOG_B" ]] && cat "$LOG_B"
fi

echo ""
echo "Done seeding."
echo ""
echo "Each workspace's memory pane now sees:"
echo "  - its own patterns under \"local\""
echo "  - the OTHER workspace's patterns under \"mesh\" (auto-aggregated by the backend)"
echo ""
echo "Refresh the memory pane in the browser to see the patterns."
