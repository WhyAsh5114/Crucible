# Crucible

**Describe a dApp. Watch it build itself. Ship it.**

> An AI agent that writes, compiles, deploys, and previews decentralized applications — all in one browser tab, with full transparency into every step.

---

## The Problem

Building a dApp today requires duct-taping 5 disconnected tools:

1. **An editor** (VS Code / Remix) to write Solidity + frontend code
2. **A terminal** to run a local node (Anvil / Hardhat)
3. **A browser** to test the frontend
4. **A wallet extension** (MetaMask) — manually add localhost RPC, import private keys, reset nonces on every restart
5. **A block explorer** to debug failed transactions

You spend more time wiring tools together than writing code. And none of these tools talk to each other — least of all, to your AI assistant, which can only see your text files and has zero awareness of your chain state, wallet balances, or deployment history.

**The result:** Web3 development is inaccessible to newcomers, painfully slow for veterans, and completely opaque to AI.

---

## The Solution

**Crucible** is a browser-based **agentic development environment** for Web3. You describe what you want in natural language. A 0G-native open agent — built as a Web3-development extension to **OpenClaw**, with sealed inference on **0G Compute**, an OpenAI-compatible fallback path for degraded public-beta mode, and persistent memory on **0G Storage** — builds it in front of your eyes.

The agent doesn't just write code. It **compiles contracts, spins up a local chain, deploys, renders a live preview, heals failed transactions, and ships to a real chain via KeeperHub** — all within a single unified workspace. Every action is visible, inspectable, and overridable.

Crucible agents are also **peers**. Each instance is a node on the **Gensyn AXL** mesh: when your local agent hits a revert it has never seen, it can pull a verified fix from another developer's agent that solved it yesterday — and contribute its own fixes back.

Think **v0 by Vercel, but for dApps**, where the agent has long-term memory, a peer network, and a production execution layer baked in.

---

## Core Architecture

The agent is the primary interface. The editor, chain, wallet, preview, peer mesh, and shipping pipeline are **tools the agent wields** — and the developer can observe, inspect, or override at any point.

Crucible is engineered around three structural commitments — each chosen because it makes a sponsor integration *load-bearing* rather than decorative:

1. **The agent is a 0G-native open agent**, not a closed SDK wrapper. It's built as a Web3-development extension to the **OpenClaw** framework, with sealed inference on **0G Compute** (e.g., `qwen3.6-plus` / `GLM-5-FP8`) and persistent memory on **0G Storage** (KV for hot state, Log for full history).
2. **Every Crucible instance is an AXL node.** When the local agent hits an unfamiliar revert, it queries its own 0G Storage memory first; on miss, it broadcasts a structured help request over **Gensyn AXL** to peer Crucible nodes. Real cross-node communication, not in-process actor theater.
3. **Local-first, ship via KeeperHub.** Hardhat handles the local dev loop. The moment the user clicks *Ship*, every onchain action — deployments, configuration calls, post-deploy verification txs — is routed through **KeeperHub** (simulation → gas → execution → retries → audit trail). KeeperHub is the only path from local to public chain.

The three integrations compose into one coherent narrative: **0G is where the agent thinks and remembers, AXL is how agents share what they've learned, KeeperHub is how the agent moves value when it matters.**

---

## Runtime Model

Crucible is not storing a fake project in browser state. Each workspace has a real backend-owned project directory, a real terminal session, and a real preview server.

### Workspace Files Are the Source of Truth

For every workspace, the backend creates a real project root:

```text
/workspace/{workspaceId}/
   contracts/
   frontend/
   .crucible/
```

- The agent writes Solidity and frontend code into that workspace directory.
- `compiler-mcp` reads contracts from disk and writes artifacts into `.crucible/artifacts/`.
- `deployer-mcp` reads those artifacts, deploys locally, and records deployments in `.crucible/state.json`.
- The editor reflects files from that workspace. Manual edits and agent edits both mutate the same source of truth.

### The Preview Is a Real Dev Server

The preview pane is not a blob URL. The backend starts a per-workspace frontend dev server in `/workspace/{workspaceId}/frontend/` and exposes it through a readable Portless URL such as:

```text
https://preview.{workspaceId}.crucible.localhost
```

That means the preview behaves like a normal app during development: module loading, HMR, network requests, wallet injection, and testnet switching all work against a real origin.

### The Terminal Is a First-Class Part of the Product

Crucible includes a real PTY-backed terminal, rendered in the browser with **wterm** and powered by a backend shell session.

- The agent writes visible output to the terminal when it compiles, deploys, traces, or patches code.
- The user can intervene with manual commands in the same terminal session.
- Terminal state is per-workspace, so the user and the agent share the same shell context and current working directory.

### Local DX Uses Portless, Not Raw Ports

For local development, Crucible uses **Portless** so the system is reachable through readable HTTPS hostnames instead of memorized ports.

- Main app: `https://crucible.localhost`
- Preview app: `https://preview.{workspaceId}.crucible.localhost`
- Internal MCP services still run on loopback ports, but developers rarely need to think about them directly.

---

## Key Features

### 1. The Agent Drives, You Steer

The default flow is **agent-driven**:

- User prompts: *"Build me a custom Uniswap v4 hook that charges a 0.1% fee on swaps over 10 ETH."*
- The agent generates the Solidity hook contract and a test frontend, compiles, deploys to the local chain (with a forked Uniswap v4 pool), and renders the live dApp — all visible in real-time across the workspace panes.
- The user can intervene at any point: edit code manually, inspect a transaction, switch accounts, or ask the agent to iterate.

This is not "an IDE with a chat sidebar." The chat **is** the primary interface.

### 2. Zero-Config Local Chain (Backend-Hosted)

- **Each workspace gets its own server-side Hardhat child process** when it opens. Chain state, snapshots, deployed addresses, and wallet nonces are isolated per workspace. The full EVM, solc compiler, and transaction tracer run on the backend — no WASM, no browser performance issues.
- **WebSocket RPC proxy** pipes the chain to the browser. The live preview and dev wallet are pre-wired. The agent deploys directly via MCP.
- **Snapshots & resets:** The agent can snapshot chain state before risky operations and roll back if something breaks.
- **Mainnet fork mode:** The agent can fork any chain at any block number for realistic testing against live protocol state (Uniswap pools, Aave markets, etc.).

### 3. The Embedded Dev Wallet

- **No MetaMask required.** When the local chain starts, the 10 pre-funded accounts (Alice, Bob, etc.) are auto-imported into an embedded wallet — labeled, funded, and ready.
- **In-tab signing:** Transaction approval popups appear inside the workspace. No extension switching.
- **Nonce auto-sync:** Chain resets automatically reset wallet nonces. The "nonce too high" error is eliminated by design.

### 4. Self-Healing Reverts (Hero Feature)

When a transaction reverts, the agent doesn't just show an error. It **autonomously diagnoses and fixes** the issue:

1. **Detect:** The agent observes the revert (from its own deployment or from a user interaction in the preview).
2. **Trace:** It calls `trace(tx_hash)` through `deployer-mcp`, getting the full EVM execution trace — decoded call stack, storage reads/writes, and the exact opcode where execution failed.
3. **Recall (0G Storage):** Before reasoning from scratch, it queries `memory-mcp.recall()` for similar revert signatures it — or any other Crucible node — has solved before.
4. **Ask the mesh (AXL):** On a memory miss, it broadcasts a structured help request via `mesh-mcp.broadcast_help()`. Peer Crucible nodes respond with candidate patches and verification receipts. All over AXL, no central broker.
5. **Diagnose & Fix:** With or without a peer hint, it produces a contract-level fix, recompiles, and redeploys to a snapshot of the local chain.
6. **Verify:** It re-executes the original transaction. On success, it commits the snapshot.
7. **Remember (0G Storage):** It writes the verified `{revert_signature → patch + trace + receipt}` triple back to 0G Storage, contributing to the shared knowledge layer.

### 5. Live dApp Preview

- The preview pane renders a real frontend dev server rooted at `/workspace/{workspaceId}/frontend/`, not an ephemeral browser-only bundle.
- The preview is automatically injected with the local chain's RPC (via WebSocket proxy) and the embedded wallet's signer.
- Every interaction (mint, swap, transfer) is reflected in real-time in the **Transaction Inspector** pane — showing decoded function calls, gas usage, event logs, and state changes.
- The agent watches the preview too — if a user action triggers a revert, the **Self-Healing Revert** loop kicks in automatically.

### 6. Ship to Public Chains via KeeperHub

When the user is satisfied with the local build, they click **Ship**. This is the only place public-chain transactions happen — and they all flow through KeeperHub.

- The agent picks a target (Sepolia, Base Sepolia, mainnet) and the user's signer.
- `KeeperHub.simulate_bundle()` runs the deployment + initial configuration calls as a bundle. The Inspector shows decoded simulation output and a per-tx gas estimate.
- `KeeperHub.execute_tx()` then submits each tx with retry logic, gas optimization, and private routing where available.
- The Inspector shows live status (`pending → mined → confirmed`), retry count, and the KeeperHub **audit trail ID** for every shipped transaction.
- Subsequent post-deploy interactions (the user clicking *Mint* or *Swap* on the live preview while pointed at the deployed testnet address) also route through KeeperHub — making the integration *load-bearing*, not a one-shot deploy button.

---

## How It Compares

| | Remix | ChainIDE | v0 (Vercel) | **Crucible** |
| :--- | :--- | :--- | :--- | :--- |
| **AI-Driven** | No | No | Yes (frontend only) | **Yes (full-stack + chain)** |
| **Local Chain** | JS VM (limited) | Partial | No | **Full Hardhat node (server-side)** |
| **Embedded Wallet** | Yes (basic) | No | N/A | **Pre-funded, labeled, auto-synced** |
| **Live dApp Preview** | No | No | Yes | **Yes, with chain injection** |
| **Tx Inspector** | Basic | Basic | No | **Decoded traces, events, KeeperHub audit trail** |
| **Agent has chain context** | No | No | No | **Yes, via MCP** |
| **Persistent agent memory** | No | No | No | **Yes, on 0G Storage (cross-session, cross-node)** |
| **Peer knowledge mesh** | No | No | No | **Yes, via Gensyn AXL** |
| **Self-Healing Reverts** | No | No | No | **Recall → mesh → patch → verify → remember** |
| **Ship to public chains** | Manual | Manual | N/A | **One-click via KeeperHub (with audit trail)** |

---

## Tech Stack

| Layer | Choice | Notes |
| :--- | :--- | :--- |
| **Runtime** | Bun 1.3.x | Native TS execution, no build step; Hardhat is the only exception (spawned via `node`) |
| **Language** | TypeScript 6.x | Bun runs `.ts` directly |
| **Build orchestration** | Turborepo 2.x | Task graph, remote cache |
| **Local DX routing** | Portless | Stable `.localhost` URLs instead of hardcoded ports |
| **Backend HTTP/WS** | Hono 4.x (Bun adapter) | Built-in WS upgrade via `hono/ws` |
| **MCP SDK** | `@modelcontextprotocol/sdk` | HTTP transport, Zod-validated tools |
| **Frontend** | SvelteKit 2.x | Reactive stores for agent event streaming |
| **Editor** | CodeMirror 6.x | `@codemirror/lang-solidity` |
| **Terminal UI** | `@wterm/react` + `node-pty` | Browser-rendered terminal backed by a real PTY session |
| **Chain libraries** | viem 2.x | Full TS types for ABIs, actions, accounts |
| **Local chain** | Hardhat 2.22+ | Fork, snapshots, `hardhat_getTransactionTrace` |
| **Solidity compiler** | solc-js 0.8.x | Backend-only, never in browser |
| **Inference** | 0G Compute primary + OpenAI-compatible fallback | 0G is the default/judged path with verifiable receipts; fallback is for degraded public beta only |
| **Persistent memory** | 0G Storage (KV + Log) | KV = recall index; Log = full history |
| **Peer mesh** | Gensyn AXL node binary | Separate process per backend instance |
| **Production execution** | KeeperHub MCP | Only public-chain path, no exceptions |
| **Validation** | Zod 3.x | All MCP tool args + HTTP request bodies |
| **Testing** | Vitest 4.x | ESM, viem, SvelteKit compatible |

We intentionally do **not** run the programming runtime inside WebContainers. Hardhat tracing, long-lived chain state, and the AXL node all require real backend-managed processes. The browser renders the development surface; the backend owns the runtime.

Fallback policy: **0G Compute is always the primary inference provider**. The OpenAI-compatible fallback exists only so demos and public testing do not hard-fail when 0G credits are exhausted, a provider is rate-limited, or the service is temporarily unavailable. When fallback is active, the UI must show the active provider clearly.

---

## End-to-End UX

### 1. Open a Workspace

The user lands on `https://crucible.localhost` and either creates or reopens a workspace. The backend creates `/workspace/{workspaceId}/`, starts the local chain, boots the AXL node, restores the workspace files, opens a PTY terminal session, and returns the workspace state.

### 2. Prompt the Agent

The user types a prompt such as *"Build me a token vault with deposit, withdraw, and a 24-hour withdrawal cooldown."* The agent receives the prompt plus the current workspace context, calls the inference router (0G Compute primary; OpenAI-compatible fallback only in degraded mode), and begins emitting visible tool activity.

### 3. Watch Code Appear

The agent writes real files into the workspace directory. CodeMirror updates as files change. Compilation runs against those same files on disk, so the editor, compiler, deployer, and preview are always looking at the same project state.

### 4. See the App Running

The backend starts or refreshes the workspace preview server, and the preview pane loads the app from its own Portless URL. The injected wallet and local RPC are already wired in, so the user can click buttons immediately.

### 5. Inspect What Happened

Every important system surface is visible:

- **Editor:** current source files
- **Preview:** live dApp UI
- **Inspector:** decoded transactions, traces, events, KeeperHub status, active inference provider, and receipts when available
- **Terminal:** compiler output, deploy logs, agent progress, and manual shell access

### 6. Recover from Failure

If a transaction reverts, the agent traces it, checks shared memory, asks the mesh if needed, verifies a patch in a snapshot, updates the workspace files, and explains what changed. The user sees the full sequence in the inspector and terminal instead of a single magic success message.

### 7. Ship to a Real Chain

When the user clicks **Ship**, the agent hands execution to KeeperHub. Simulation, gas estimation, execution, retry count, and audit trail IDs are shown in the Inspector. Once shipped, the preview can point at the deployed address and keep using KeeperHub for public-chain interactions.

---

## The Demo (4 Minutes)

The narrative is one continuous build → break → heal → ship arc:

1. **(0:00–0:25)** Problem slide + three sponsor logos. *"Web3 dev is 5 disconnected tools and an AI that can't see your chain."*
2. **(0:25–1:15)** **Build.** User prompts: *"Build me a token vault with deposit, withdraw, and a 24-hour withdrawal cooldown."* Agent writes contracts and frontend, compiles, deploys to local Hardhat, renders the live dApp. **Inspector shows a verifiable inference receipt from 0G Compute.**
3. **(1:15–2:30)** **Break and Heal — the money shot.** User triggers a withdraw before the cooldown elapses. Tx reverts.
   - Inspector shows the trace.
   - `memory-mcp.recall()` → no local hit. *"Asking the mesh."*
   - **Cut to a second laptop** running Crucible, also on AXL. Its agent solved this exact pattern yesterday. It responds with the patch + verification receipt.
   - Local agent verifies the patch in a snapshot. Withdraw succeeds.
   - `memory-mcp.remember()` writes the verified pattern back to 0G Storage. *"Now everyone benefits."*
4. **(2:30–3:30)** **Ship.** User clicks **Ship to Sepolia**. KeeperHub takes over: bundle simulation, gas estimates, execution status with retry counter, audit trail IDs in the Inspector. User then clicks *Deposit* on the live preview — pointed at the deployed Sepolia address — and that tx also routes through KeeperHub.
5. **(3:30–4:00)** Architecture slide: **OpenClaw extension + 0G Compute/Storage** + **7 custom MCPs** + **AXL peer mesh** + **KeeperHub execution layer**.

---

## Quick Start

```bash
git clone https://github.com/username/crucible.git
cd crucible
cp .env.example .env   # fill in 0G + KeeperHub credentials
bun install
bun run dev            # wraps Portless and opens https://crucible.localhost
```

The workspace loads with a local chain already running, a PTY-backed terminal attached, the AXL node connected to the mesh, and the agent ready.

---

## Docs

- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — MCP server specs, type contracts, WebSocket channels, monorepo structure
- **[DEPLOYMENT.md](./docs/DEPLOYMENT.md)** — Live hosting architecture, Docker strategy, laptop hosting plan, AWS migration path
- **[TRACKS.md](./docs/TRACKS.md)** — Sponsor alignment, prize strategy, submission requirements per track
- **[PLAN.md](./docs/PLAN.md)** — 14-day build plan, team division, integration checkpoints, stub strategy

---

*Describe it. Watch it build. Ship it.*