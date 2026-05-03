#!/usr/bin/env bash
# seed-memories.sh — Inject demo memory patterns into running Crucible containers.
#
# Each container only writes LOCAL patterns. The backend's
# /workspace/{id}/memory/patterns endpoint automatically surfaces every OTHER
# workspace's locals as scope='mesh', so peer patterns appear in the memory
# pane without any cross-writes.
#
# Seeded distribution (20 LOCAL patterns total, 10 per container):
#   5 error groups, 3-5 patterns each, split across both containers:
#
#   Group 1 — TransferHelper::safeTransferFrom: STF   (4 patterns, split 2/2)
#   Group 2 — UniswapV2: EXPIRED                      (4 patterns, split 2/2)
#   Group 3 — ERC20: transfer amount exceeds allowance (4 patterns, split 2/2)
#   Group 4 — OTC: order already filled               (4 patterns, split 2/2)
#   Group 5 — Ownable: caller is not the owner        (4 patterns, split 2/2)
#
# In the frontend each workspace's memory pane shows:
#   - Its own 10 patterns as "local"
#   - The other container's 10 patterns as "mesh"
#   Nodes with the same revertSignature cluster together across both scopes.
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

echo "=== Seeding patterns (sequential: A then B) ==="
echo ""

seed_container_a() {
  local log="$1"

  # ── Group 1: TransferHelper::safeTransferFrom: STF (2/4) ─────────────────
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

  # ── Group 2: UniswapV2: EXPIRED (2/4) ─────────────────────────────────────
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

  # ── Group 3: ERC20: transfer amount exceeds allowance (2/4) ───────────────
  remember "$A" \
    "ERC20: transfer amount exceeds allowance" \
    "diff --git a/contracts/Vault.sol b/contracts/Vault.sol\n--- a/contracts/Vault.sol\n+++ b/contracts/Vault.sol\n@@ -20,5 +20,6 @@\n function deposit(uint amount) external {\n+  token.approve(address(this), amount);\n   token.transferFrom(msg.sender, address(this), amount);\n }" \
    "trace://erc20-vault-005" \
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" \
    "$log"
  remember "$A" \
    "ERC20: transfer amount exceeds allowance" \
    "diff --git a/contracts/Staking.sol b/contracts/Staking.sol\n--- a/contracts/Staking.sol\n+++ b/contracts/Staking.sol\n@@ -45,5 +45,7 @@\n function stake(uint amount) external {\n+  stakingToken.approve(address(this), amount);\n   stakingToken.transferFrom(msg.sender, address(this), amount);\n }" \
    "trace://erc20-staking-006" \
    "0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3" \
    "$log"

  # ── Group 4: OTC: order already filled (2/4) ──────────────────────────────
  remember "$A" \
    "OTC: order already filled" \
    "diff --git a/contracts/OTC.sol b/contracts/OTC.sol\n--- a/contracts/OTC.sol\n+++ b/contracts/OTC.sol\n@@ -34,4 +34,7 @@\n function fill(Order calldata order) external {\n+  bytes32 orderHash = _hashOrder(order);\n+  require(!filledOrders[orderHash], 'OTC: order already filled');\n+  filledOrders[orderHash] = true;\n   _settle(order);\n }" \
    "trace://otc-single-007" \
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" \
    "$log"
  remember "$A" \
    "OTC: order already filled" \
    "diff --git a/contracts/MultiOTC.sol b/contracts/MultiOTC.sol\n--- a/contracts/MultiOTC.sol\n+++ b/contracts/MultiOTC.sol\n@@ -58,4 +58,8 @@\n function fillBatch(Order[] calldata orders) external {\n   for (uint i = 0; i < orders.length; i++) {\n+    bytes32 h = _hashOrder(orders[i]);\n+    require(!filledOrders[h], 'OTC: order already filled');\n+    filledOrders[h] = true;\n     _settle(orders[i]);\n }" \
    "trace://otc-batch-008" \
    "0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4" \
    "$log"

  # ── Group 5: Ownable: caller is not the owner (2/4) ───────────────────────
  remember "$A" \
    "Ownable: caller is not the owner" \
    "diff --git a/contracts/Treasury.sol b/contracts/Treasury.sol\n--- a/contracts/Treasury.sol\n+++ b/contracts/Treasury.sol\n@@ -10,5 +10,5 @@\n-function withdraw(uint amount) external {\n+function withdraw(uint amount) external onlyOwner {\n   payable(msg.sender).transfer(amount);\n }" \
    "trace://ownable-treasury-009" \
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" \
    "$log"
  remember "$A" \
    "Ownable: caller is not the owner" \
    "diff --git a/contracts/Config.sol b/contracts/Config.sol\n--- a/contracts/Config.sol\n+++ b/contracts/Config.sol\n@@ -22,5 +22,5 @@\n-function setFee(uint bps) external {\n+function setFee(uint bps) external onlyOwner {\n   require(bps <= 1000, 'fee too high');\n   feeBps = bps;\n }" \
    "trace://ownable-config-010" \
    "0xe1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1" \
    "$log"
}

seed_container_b() {
  local log="$1"

  # ── Group 1: TransferHelper::safeTransferFrom: STF (2/4) ─────────────────
  remember "$B" \
    "TransferHelper::safeTransferFrom: STF" \
    "diff --git a/contracts/Pair.sol b/contracts/Pair.sol\n--- a/contracts/Pair.sol\n+++ b/contracts/Pair.sol\n@@ -67,4 +67,6 @@\n function addLiquidity(uint amtA, uint amtB) external {\n+  IERC20(tokenA).approve(address(this), amtA);\n+  IERC20(tokenB).approve(address(this), amtB);\n   _mintLP(msg.sender, amtA, amtB);\n }" \
    "trace://pair-stf-011" \
    "0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2" \
    "$log"
  remember "$B" \
    "TransferHelper::safeTransferFrom: STF" \
    "diff --git a/test/Swap.test.ts b/test/Swap.test.ts\n--- a/test/Swap.test.ts\n+++ b/test/Swap.test.ts\n@@ -18,3 +18,5 @@\n it('swaps exact tokens', async () => {\n+  await tokenIn.connect(user).approve(router.address, amountIn);\n   await router.connect(user).swapExactTokensForTokens(...);\n });" \
    "trace://test-stf-012" \
    "0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3" \
    "$log"

  # ── Group 2: UniswapV2: EXPIRED (2/4) ─────────────────────────────────────
  remember "$B" \
    "UniswapV2: EXPIRED" \
    "diff --git a/contracts/LimitOrder.sol b/contracts/LimitOrder.sol\n--- a/contracts/LimitOrder.sol\n+++ b/contracts/LimitOrder.sol\n@@ -41,3 +41,3 @@\n-  uint deadline = order.createdAt + 60;\n+  uint deadline = order.createdAt + 1800;\n   require(block.timestamp <= deadline, 'UniswapV2: EXPIRED');" \
    "trace://limit-order-expired-013" \
    "0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3" \
    "$log"
  remember "$B" \
    "UniswapV2: EXPIRED" \
    "diff --git a/scripts/e2e.ts b/scripts/e2e.ts\n--- a/scripts/e2e.ts\n+++ b/scripts/e2e.ts\n@@ -9,3 +9,3 @@\n-const deadline = (await provider.getBlock('latest'))!.timestamp;\n+const deadline = (await provider.getBlock('latest'))!.timestamp + 600;\n await router.swapExactETHForTokens(minOut, path, wallet.address, deadline);" \
    "trace://e2e-expired-014" \
    "0xb4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4" \
    "$log"

  # ── Group 3: ERC20: transfer amount exceeds allowance (2/4) ───────────────
  remember "$B" \
    "ERC20: transfer amount exceeds allowance" \
    "diff --git a/contracts/Bridge.sol b/contracts/Bridge.sol\n--- a/contracts/Bridge.sol\n+++ b/contracts/Bridge.sol\n@@ -33,4 +33,6 @@\n function lockAndBridge(uint amount) external {\n+  uint current = token.allowance(msg.sender, address(this));\n+  require(current >= amount, 'insufficient allowance');\n   token.transferFrom(msg.sender, address(this), amount);\n   emit BridgeInitiated(msg.sender, amount);\n }" \
    "trace://bridge-allowance-015" \
    "0xc4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4" \
    "$log"
  remember "$B" \
    "ERC20: transfer amount exceeds allowance" \
    "diff --git a/frontend/src/hooks/useDeposit.ts b/frontend/src/hooks/useDeposit.ts\n--- a/frontend/src/hooks/useDeposit.ts\n+++ b/frontend/src/hooks/useDeposit.ts\n@@ -12,4 +12,7 @@\n async function deposit(amount: bigint) {\n+  const allowance = await token.allowance(address, vaultAddress);\n+  if (allowance < amount) {\n+    await (await token.approve(vaultAddress, amount)).wait();\n+  }\n   await vault.deposit(amount);\n }" \
    "trace://frontend-allowance-016" \
    "0xc5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5" \
    "$log"

  # ── Group 4: OTC: order already filled (2/4) ──────────────────────────────
  remember "$B" \
    "OTC: order already filled" \
    "diff --git a/contracts/RFQ.sol b/contracts/RFQ.sol\n--- a/contracts/RFQ.sol\n+++ b/contracts/RFQ.sol\n@@ -28,3 +28,6 @@\n function executeRFQ(RFQOrder calldata order, bytes calldata sig) external {\n+  bytes32 rfqHash = _hashRFQ(order);\n+  if (executedRFQs[rfqHash]) revert AlreadyFilled();\n+  executedRFQs[rfqHash] = true;\n   _verify(order, sig);\n }" \
    "trace://rfq-filled-017" \
    "0xd5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5" \
    "$log"
  remember "$B" \
    "OTC: order already filled" \
    "diff --git a/contracts/SettlementLayer.sol b/contracts/SettlementLayer.sol\n--- a/contracts/SettlementLayer.sol\n+++ b/contracts/SettlementLayer.sol\n@@ -71,3 +71,6 @@\n function settle(bytes32 intentHash, Settlement calldata s) external {\n+  require(\n+    settlementStatus[intentHash] == Status.Pending,\n+    'OTC: order already filled'\n+  );\n   _processSettlement(intentHash, s);\n }" \
    "trace://settlement-filled-018" \
    "0xd6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6" \
    "$log"

  # ── Group 5: Ownable: caller is not the owner (2/4) ───────────────────────
  remember "$B" \
    "Ownable: caller is not the owner" \
    "diff --git a/contracts/Upgradeable.sol b/contracts/Upgradeable.sol\n--- a/contracts/Upgradeable.sol\n+++ b/contracts/Upgradeable.sol\n@@ -15,5 +15,5 @@\n-function upgradeTo(address newImpl) external {\n+function upgradeTo(address newImpl) external onlyOwner {\n   _authorizeUpgrade(newImpl);\n   _upgradeTo(newImpl);\n }" \
    "trace://ownable-upgrade-019" \
    "0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2" \
    "$log"
  remember "$B" \
    "Ownable: caller is not the owner" \
    "diff --git a/contracts/Pausable.sol b/contracts/Pausable.sol\n--- a/contracts/Pausable.sol\n+++ b/contracts/Pausable.sol\n@@ -8,5 +8,5 @@\n-function pause() external {\n+function pause() external onlyOwner {\n   _pause();\n }\n-function unpause() external {\n+function unpause() external onlyOwner {\n   _unpause();\n }" \
    "trace://ownable-pause-020" \
    "0xe3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3" \
    "$log"
}

LOG_A="$SEED_TMPDIR/a.log"
LOG_B="$SEED_TMPDIR/b.log"

echo "--- $A ---"
seed_container_a "$LOG_A"
cat "$LOG_A"

if [[ -n "$B" ]]; then
  echo ""
  echo "--- $B ---"
  seed_container_b "$LOG_B"
  cat "$LOG_B"
fi

echo ""
echo "Done seeding."
echo ""
echo "Each workspace's memory pane now sees:"
echo "  - its own 10 patterns as \"local\"  (5 groups × 2 each)"
echo "  - the OTHER workspace's 10 patterns as \"mesh\" (auto-aggregated by the backend)"
echo "  - 5 error clusters: STF, EXPIRED, ERC20-allowance, OTC-filled, Ownable"
echo ""
echo "Refresh the memory pane in the browser to see the patterns."
