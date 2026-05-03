#!/usr/bin/env bash
# seed-memories.sh — Inject demo memory patterns into running Crucible containers.
#
# Discovers all running crucible-ws-* containers and distributes patterns so
# the memory pane looks like a real mesh: each container has its own local
# patterns PLUS mesh patterns received from other containers.
#
# Usage:
#   bash scripts/seed-memories.sh          # auto-discover containers
#   bash scripts/seed-memories.sh ws-a ws-b  # use specific container names

set -euo pipefail

MEMORY_PORT=3104

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

# ── Helper ────────────────────────────────────────────────────────────────────

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

  docker exec "$container" sh -c \
    "curl -sf -X POST http://127.0.0.1:${MEMORY_PORT}/remember \
      -H 'Content-Type: application/json' \
      -d '${payload}'" \
  | { read -r id; echo "    → $id"; } || echo "    → (failed — container may not have memory service ready)"
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
echo "Done. Both containers now have local + cross-mesh patterns."
