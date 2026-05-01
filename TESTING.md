## 0G Local Setup & Testing Guide

This covers all three 0G capabilities in this PR: **Compute Router** (inference), **Storage KV + Log** (memory), and **0G Chain** (deployer). You only need what you want to test — each section is independent.

### Prerequisites

- Bun 1.3.6 (`bun --version`)
- Docker running (`docker info`)
- Postgres running (see below)
- Accounts on [pc.testnet.0g.ai](https://pc.testnet.0g.ai) (Compute) and the 0G testnet for Storage/Deploy

### 1. Postgres & DB setup

```bash
# Start postgres however you normally do (Docker example)
docker run -d --name crucible-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

# Apply all migrations (runs from packages/backend)
cd packages/backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crucible" \
  bunx --bun prisma migrate deploy
```

The latest migration (`20260430180253_add_new_ports`) adds `memoryPort` and `devtoolsPort` to `workspace_runtime` — it will run automatically here.

---

### 2. Environment variables

Create .env (never committed):

```env
# ── Required always ──────────────────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crucible"
BETTER_AUTH_SECRET="any-long-random-string"

# ── 0G Compute Router — inference ────────────────────────────────────────────
# Get from: https://pc.testnet.0g.ai  →  API Keys
OG_API_KEY="sk-..."
# Any model listed on the Compute Router. Try:
OG_MODEL="zai-org/GLM-5-FP8"
# Optional — defaults to testnet. Only override for mainnet.
# OG_ROUTER_URL="https://router-api-testnet.integratenetwork.work/v1"

# ── 0G Storage — mcp-memory KV + Log backend ─────────────────────────────────
# A funded EOA private key on 0G Galileo testnet (chainId 16602)
# Fund at: https://faucet.0g.ai
OG_STORAGE_PRIVATE_KEY="0x..."
# KV endpoint — get from 0G docs or storage dashboard
OG_STORAGE_KV_URL="https://..."
# These have working defaults; only override if needed:
# OG_STORAGE_RPC_URL="https://evmrpc-testnet.0g.ai"
# OG_STORAGE_INDEXER_URL="https://indexer-storage-testnet-turbo.0g.ai"
# OG_STORAGE_LOCAL_STREAM_ID="0x..."   # auto-derived from private key if unset
# OG_STORAGE_MESH_STREAM_ID="0x...01"  # default is the shared mesh stream

# ── 0G Chain deployment — mcp-deployer ───────────────────────────────────────
# Same key as Storage is fine. Must have OG testnet ETH.
OG_DEPLOY_PRIVATE_KEY="0x..."
```

**Key insight:** `OG_API_KEY`+`OG_MODEL` activate Compute. `OG_STORAGE_PRIVATE_KEY`+`OG_STORAGE_KV_URL` activate Storage. `OG_DEPLOY_PRIVATE_KEY` activates 0G Chain deploys. Each is independent — unset any and that path degrades gracefully.

---

### 3. Build the runtime Docker image

The container inherits all `OG_*` vars from the host at runtime (via `buildContainerEnv` — the change from this session). You only need to rebuild when you change the Dockerfile.

```bash
cd packages/backend
bun run runtime:build
```

This produces `crucible-runtime:latest` containing all 7 MCP servers including `mcp-memory` and `mcp-deployer`.

---

### 4. Start the backend

```bash
cd packages/backend
bun run dev
```

Watch the startup log. Look for:

- `[og-adapter] using 0G Compute Router model=...` → Compute active
- If `OG_API_KEY` is missing: fallback to OpenAI-compatible; inference still works but receipts won't say `0g-compute`

---

### 5. Testing 0G Compute (inference receipts)

1. Open the frontend (frontend → `bun run dev`)
2. Sign in with a wallet (SIWE)
3. Create a workspace, wait for it to boot (`ready` status)
4. Send any prompt in the chat rail
5. In the event stream, look for an `inference_receipt` row — it should show **"0G Compute"** in green with the TEE attestation request ID. If fallback fired (e.g. rate limit), it shows **"Fallback mode"** in amber.

To force-verify via API directly:

```bash
curl -s -X POST http://localhost:3000/api/inference \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role":"user","content":"hello"}]}' | jq .
```

Look for `provider: "0g-compute"` and `ogTrace` in the response.

---

### 6. Testing 0G Storage (mcp-memory)

The storage backend activates inside the container when `OG_STORAGE_PRIVATE_KEY` and `OG_STORAGE_KV_URL` are set. No code changes needed — the env vars pass through automatically.

**To verify the KV path is active**, `exec` into a running workspace container:

```bash
# Find your container name
docker ps --filter "name=crucible-ws"

# Check the memory MCP startup log
docker logs crucible-ws-<workspaceId> 2>&1 | grep mcp-memory
```

You should see `[mcp-memory] 0G KV backend active` vs `[mcp-memory] local FS backend (OG_STORAGE_PRIVATE_KEY not set)`.

To test the `remember`/`recall` tools directly:

```bash
# Hit the memory MCP REST API (port is dynamic — check DB or docker inspect)
MEMORY_PORT=$(docker inspect crucible-ws-<id> \
  --format '{{(index (index .NetworkSettings.Ports "3104/tcp") 0).HostPort}}')

# Remember a pattern
curl -s -X POST http://localhost:$MEMORY_PORT/remember \
  -H "Content-Type: application/json" \
  -d '{
    "revertSignature": "InsufficientBalance(uint256,uint256)",
    "patch": "require(balance >= amount)",
    "traceRef": "0xabc",
    "verificationReceipt": "0x123",
    "scope": "local"
  }' | jq .

# Recall it
curl -s -X POST http://localhost:$MEMORY_PORT/recall \
  -H "Content-Type: application/json" \
  -d '{"revertSignature": "InsufficientBalance"}' | jq .
```

With `OG_STORAGE_PRIVATE_KEY` set, these hits write to 0G Storage KV. Without it, they write to `.crucible/memory/patterns.json` inside the container.

---

### 7. Testing 0G Chain deployment (mcp-deployer)

The agent uses `deploy_0g_chain` when you ask it to deploy to testnet. You can also call it directly:

```bash
DEPLOYER_PORT=$(docker inspect crucible-ws-<id> \
  --format '{{(index (index .NetworkSettings.Ports "3102/tcp") 0).HostPort}}')

# Deploy a compiled contract to 0G Galileo testnet
curl -s -X POST http://localhost:$DEPLOYER_PORT/deploy-0g-chain \
  -H "Content-Type: application/json" \
  -d '{
    "contractName": "Counter",
    "constructorData": "0x"
  }' | jq .
```

On success you get `{ address, txHash, gasUsed, explorerUrl }` where `explorerUrl` points to `https://chainscan-galileo.0g.ai/tx/...`. Save the `address` — this is what goes in the submission's **contract deployment addresses** checklist item.

---

### 8. What each missing env var degrades to

| Unset                     | Effect                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `OG_API_KEY` / `OG_MODEL` | Inference falls back to OpenAI-compatible; UI shows fallback mode                |
| `OG_STORAGE_PRIVATE_KEY`  | `mcp-memory` uses local filesystem; patterns survive only for container lifetime |
| `OG_STORAGE_KV_URL`       | Error at startup if `OG_STORAGE_PRIVATE_KEY` is set (required pair)              |
| `OG_DEPLOY_PRIVATE_KEY`   | `deploy_0g_chain` tool throws "not configured"; local deploy still works         |

---

### 9. Submission checklist items still needed

After a successful demo run, collect:

- **Contract deployment addresses** — from the `deploy_0g_chain` responses during the demo, on 0G Galileo testnet (`chainId 16602`, explorer: `chainscan-galileo.0g.ai`)
- **Architecture diagram** — showing OpenClaw → 0G Compute Router → 0G Storage KV/Log flow (required for both Track 1 and Track 2)
- **Demo video cut** — separate 3-min 0G-focused cut from the main demo
