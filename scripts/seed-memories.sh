#!/usr/bin/env bash
# seed-memories.sh — Inject demo memory patterns into running Crucible containers.
#
# Discovers all running crucible-ws-* containers and distributes patterns so
# the memory pane looks like a real mesh: each container has its own local
# patterns PLUS mesh patterns received from other containers.
#
# After writing, polls GET /patterns on each container until every seeded
# pattern ID appears — necessary because the 0G KV indexer has a propagation
# delay between a write transaction landing on-chain and the read path
# reflecting it.  Times out after 60 seconds per container.
#
# Usage:
#   bash scripts/seed-memories.sh          # auto-discover containers
#   bash scripts/seed-memories.sh ws-a ws-b  # use specific container names

set -euo pipefail

MEMORY_PORT=3104
VERIFY_TIMEOUT=60   # seconds to wait per container for patterns to appear
VERIFY_INTERVAL=3   # poll interval in seconds

# ── Discover containers ───────────────────────────────────────────────────────

if [[ $# -ge 2 ]]; then
  mapfile -t CONTAINERS < <(printf '%s\n' "$@")
else
  mapfile -t CONTAINERS < <(docker ps --filter 'name=crucible-ws-' --format '{{.Names}}' | sort)
fi

if [[ ${#CONTAINERS[@]} -eq 0 ]]; then
  echo "No running crucible-ws-* containers found." >&2
  exit 1
fi

if [[ ${#CONTAINERS[@]} -lt 2 ]]; then
  echo "Warning: only 1 container found (${CONTAINERS[0]}). Mesh patterns will reference a fake peer ID." >&2
  CONTAINERS+=("crucible-ws-peer-demo")
fi

echo "Containers: ${CONTAINERS[*]}"
echo ""

# ── Track expected IDs per container ─────────────────────────────────────────
# Associative array: container → space-separated list of pattern IDs to verify.

declare -A EXPECTED_IDS

# ── Helpers ───────────────────────────────────────────────────────────────────

remember() {
  local container="$1"
  local revert_sig="$2"
  local patch="$3"
  local trace_ref="$4"
  local receipt="$5"
  local from_peer="${6:-}"

  local payload
  if [[ -n "$from_peer" ]]; then
    payload=$(printf '{"revertSignature":"%s","patch":"%s","traceRef":"%s","verificationReceipt":"%s","fromPeerId":"%s"}' \
      "$revert_sig" "$patch" "$trace_ref" "$receipt" "$from_peer")
    echo "  [mesh ← $from_peer]  $revert_sig"
  else
    payload=$(printf '{"revertSignature":"%s","patch":"%s","traceRef":"%s","verificationReceipt":"%s"}' \
      "$revert_sig" "$patch" "$trace_ref" "$receipt")
    echo "  [local]              $revert_sig"
  fi

  local response
  response=$(docker exec "$container" sh -c \
    "curl -sf -X POST http://127.0.0.1:${MEMORY_PORT}/remember \
      -H 'Content-Type: application/json' \
      -d '${payload}'" 2>/dev/null) || { echo "    → FAILED (is the memory service running?)"; return; }

  # Response is {"id":"pattern-xxxxx"}
  local id
  id=$(printf '%s' "$response" | sed 's/.*"id":"\([^"]*\)".*/\1/')
  echo "    → $id"

  # Accumulate for later verification
  EXPECTED_IDS["$container"]="${EXPECTED_IDS[$container]:-} $id"
}

# Poll GET /patterns until all expected IDs for a container appear, or timeout.
verify_container() {
  local container="$1"
  local ids="${EXPECTED_IDS[$container]:-}"

  if [[ -z "${ids// }" ]]; then
    echo "  (no patterns to verify)"
    return 0
  fi

  local expected_count
  expected_count=$(echo "$ids" | wc -w | tr -d ' ')
  echo "  Waiting for $expected_count patterns to be readable (timeout ${VERIFY_TIMEOUT}s)…"

  local elapsed=0
  while [[ $elapsed -lt $VERIFY_TIMEOUT ]]; do
    local response
    response=$(docker exec "$container" sh -c \
      "curl -sf 'http://127.0.0.1:${MEMORY_PORT}/patterns?limit=50'" 2>/dev/null) || true

    if [[ -n "$response" ]]; then
      local visible_count=0
      local missing=""
      for id in $ids; do
        if echo "$response" | grep -qF "\"$id\""; then
          (( visible_count++ )) || true
        else
          missing="$missing $id"
        fi
      done

      if [[ $visible_count -eq $expected_count ]]; then
        echo "  ✓ All $expected_count patterns confirmed readable (${elapsed}s)"
        return 0
      fi

      local still_missing
      still_missing=$(echo "$missing" | wc -w | tr -d ' ')
      echo "  … ${elapsed}s: ${visible_count}/${expected_count} visible, ${still_missing} still propagating"
    else
      echo "  … ${elapsed}s: memory service not responding yet"
    fi

    sleep "$VERIFY_INTERVAL"
    (( elapsed += VERIFY_INTERVAL )) || true
  done

  echo "  ✗ Timed out after ${VERIFY_TIMEOUT}s — 0G KV indexer may still be catching up."
  echo "    Patterns were written (transactions confirmed); try refreshing the memory pane in ~30s."
  return 1
}

# ── Container aliases ─────────────────────────────────────────────────────────
# Use first two containers for a clean A↔B cross-mesh demo.

A="${CONTAINERS[0]}"
B="${CONTAINERS[1]}"

# ── Patterns for Container A (local discoveries) ─────────────────────────────

echo "=== $A: local patterns ==="
remember "$A" \
  "TransferHelper::safeTransferFrom: STF" \
  "diff --git a/contracts/Swap.sol b/contracts/Swap.sol\n--- a/contracts/Swap.sol\n+++ b/contracts/Swap.sol\n@@ -12,6 +12,8 @@\n function swapExactTokensForTokens(...) {\n+  IERC20(tokenIn).approve(address(router), amountIn);\n   router.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline);\n }" \
  "trace://uniswap-v2-stf-001" \
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

remember "$A" \
  "UniswapV2: EXPIRED" \
  "diff --git a/contracts/Swap.sol b/contracts/Swap.sol\n--- a/contracts/Swap.sol\n+++ b/contracts/Swap.sol\n@@ -8,1 +8,1 @@\n-  uint deadline = block.timestamp - 1;\n+  uint deadline = block.timestamp + 300;" \
  "trace://uniswap-v2-expired-002" \
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

# ── Patterns for Container B (local discoveries) ─────────────────────────────

echo ""
echo "=== $B: local patterns ==="
remember "$B" \
  "ERC20: transfer amount exceeds allowance" \
  "diff --git a/contracts/Vault.sol b/contracts/Vault.sol\n--- a/contracts/Vault.sol\n+++ b/contracts/Vault.sol\n@@ -20,5 +20,6 @@\n function deposit(uint amount) external {\n+  token.approve(address(this), amount);\n   token.transferFrom(msg.sender, address(this), amount);\n }" \
  "trace://erc20-allowance-003" \
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

remember "$B" \
  "OTC: order already filled" \
  "diff --git a/contracts/OTC.sol b/contracts/OTC.sol\n--- a/contracts/OTC.sol\n+++ b/contracts/OTC.sol\n@@ -34,4 +34,7 @@\n function fill(Order calldata order) external {\n+  require(!filledOrders[orderHash], 'OTC: order already filled');\n+  filledOrders[orderHash] = true;\n   _settle(order);\n }" \
  "trace://otc-filled-004" \
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

# ── Cross-mesh: A stores patterns received from B ─────────────────────────────

echo ""
echo "=== $A: mesh patterns received from $B ==="
remember "$A" \
  "UniswapV2: K" \
  "diff --git a/contracts/Liquidity.sol b/contracts/Liquidity.sol\n--- a/contracts/Liquidity.sol\n+++ b/contracts/Liquidity.sol\n@@ -18,3 +18,5 @@\n function addLiquidity(...) {\n+  // Sort tokens — UniV2 requires token0 < token1\n+  (tokenA, tokenB) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);\n   _addLiquidity(tokenA, tokenB, amountA, amountB, ...);" \
  "trace://uniswap-v2-k-005" \
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" \
  "$B"

remember "$A" \
  "OTC: signature replay" \
  "diff --git a/contracts/OTC.sol b/contracts/OTC.sol\n--- a/contracts/OTC.sol\n+++ b/contracts/OTC.sol\n@@ -29,3 +29,4 @@\n bytes32 orderHash = _hashOrder(order);\n+  require(block.chainid == order.chainId, 'OTC: wrong chain');\n   require(!filledOrders[orderHash], 'OTC: already filled');" \
  "trace://otc-replay-006" \
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" \
  "$B"

# ── Cross-mesh: B stores patterns received from A ─────────────────────────────

echo ""
echo "=== $B: mesh patterns received from $A ==="
remember "$B" \
  "Compound: INSUFFICIENT_LIQUIDITY" \
  "diff --git a/contracts/Borrow.sol b/contracts/Borrow.sol\n--- a/contracts/Borrow.sol\n+++ b/contracts/Borrow.sol\n@@ -11,3 +11,5 @@\n function borrow(uint amount) external {\n+  uint cash = cToken.getCash();\n+  require(cash >= amount, 'Compound: INSUFFICIENT_LIQUIDITY');\n   cToken.borrow(amount);" \
  "trace://compound-liquidity-007" \
  "0x1111111111111111111111111111111111111111111111111111111111111111" \
  "$A"

remember "$B" \
  "Safe: GS025" \
  "diff --git a/scripts/execTx.ts b/scripts/execTx.ts\n--- a/scripts/execTx.ts\n+++ b/scripts/execTx.ts\n@@ -8,3 +8,5 @@\n const sigs = [sig1];\n+// Safe requires threshold signatures; collect all required owners\n+const sigs = await Promise.all(owners.slice(0, threshold).map(o => o.signTypedData(...)));\n const tx = await safe.execTransaction(...);" \
  "trace://safe-gs025-008" \
  "0x2222222222222222222222222222222222222222222222222222222222222222" \
  "$A"

echo ""
echo "Done seeding. Verifying patterns are readable via the 0G KV indexer…"
echo ""
echo "=== Verifying $A ==="
verify_container "$A"
echo ""
echo "=== Verifying $B ==="
verify_container "$B"
echo ""
echo "All done."