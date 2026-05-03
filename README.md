# Crucible

![Crucible Cover](packages/frontend/static/cover_image.png 'Crucible - AI-Powered dApp Development')

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

The agent doesn't just write code. It **compiles contracts, spins up a local chain, deploys (locally or to 0G Galileo), renders a live preview, heals failed transactions, and wires keepers and on-chain automation through KeeperHub** — all within a single unified workspace. Every action is visible, inspectable, and overridable.

Crucible agents are also **peers**. Each instance is a node on the **Gensyn AXL** mesh: when your local agent hits a revert it has never seen, it can pull a verified fix from another developer's agent that solved it yesterday — and contribute its own fixes back.

Think **v0 by Vercel, but for dApps**, where the agent has long-term memory, a peer network, and a production execution layer baked in.

---

## Core Architecture

The agent is the primary interface. The editor, chain, wallet, preview, peer mesh, and shipping pipeline are **tools the agent wields** — and the developer can observe, inspect, or override at any point.

Crucible is engineered around three structural commitments — each chosen because it makes a sponsor integration _load-bearing_ rather than decorative:

1. **The agent is a 0G-native open agent**, not a closed SDK wrapper. It's built as a Web3-development extension to the **OpenClaw** framework, with sealed inference on **0G Compute** (e.g., `qwen3.6-plus` / `GLM-5-FP8`) and persistent memory on **0G Storage** (KV for hot state, Log for full history).
2. **Every Crucible instance is an AXL node.** When the local agent hits an unfamiliar revert, it queries its own 0G Storage memory first; on miss, it broadcasts a structured help request over **Gensyn AXL** to peer Crucible nodes. Real cross-node communication, not in-process actor theater.
3. **KeeperHub is the agent's automation backplane.** Once a contract is deployed (locally, to Sepolia, or to 0G Galileo), the agent connects to **KeeperHub's hosted MCP** (`https://app.keeperhub.com/mcp`) per turn and uses its native tool surface — `keeperhub_ai_generate_workflow`, `keeperhub_create_workflow`, `keeperhub_execute_workflow`, `keeperhub_get_wallet_integration`, `keeperhub_list_action_schemas` — to wire keepers, scheduled actions, and on-chain reads/writes against that contract. No hand-rolled REST shim, no parallel data model: the model picks up KeeperHub's tools the moment they ship.

The three integrations compose into one coherent narrative: **0G is where the agent thinks and remembers, AXL is how agents share what they've learned, KeeperHub is how the agent automates what it has built.**

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

In production, the main app must **not** reach across the iframe boundary and mutate the preview DOM. The preview runs on its own origin, so Crucible bootstraps a small same-origin script into the preview HTML that installs an EIP-1193-compatible `window.ethereum` inside the preview origin itself. That bridge talks back to the parent shell with exact-origin `postMessage` checks, and the parent shell forwards approved requests to the backend RPC proxy. Private keys never enter the iframe.

### The Terminal Is a First-Class Part of the Product

Crucible includes a real PTY-backed terminal, rendered in the browser with **xterm.js** and powered by a bash shell running inside the workspace's Docker runtime container via a raw socket hijack to the Docker engine.

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

- User prompts: _"Build me a custom Uniswap v4 hook that charges a 0.1% fee on swaps over 10 ETH."_
- The agent generates the Solidity hook contract and a test frontend, compiles, deploys to the local chain (with a forked Uniswap v4 pool), and renders the live dApp — all visible in real-time across the workspace panes.
- The user can intervene at any point: edit code manually, inspect a transaction, switch accounts, or ask the agent to iterate.

This is not "an IDE with a chat sidebar." The chat **is** the primary interface.

### 2. Zero-Config Local Chain (Backend-Hosted)

- **Each workspace gets its own server-side Hardhat child process** when it opens. Chain state, snapshots, deployed addresses, and wallet nonces are isolated per workspace. The full EVM, solc compiler, and transaction tracer run on the backend — no WASM, no browser performance issues.
- **Shell-owned WebSocket RPC proxy** pipes the chain to the browser. The preview gets a same-origin EIP-1193 bridge and reaches the shell through exact-origin messaging, while the agent deploys directly via MCP.
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
- The preview HTML is bootstrapped with a same-origin EIP-1193 bridge. That bridge exposes `window.ethereum` inside the preview origin, relays requests to the parent shell with exact-origin checks, and the shell forwards approved JSON-RPC calls to the backend RPC proxy.
- Every interaction (mint, swap, transfer) is reflected in real-time in the **Transaction Inspector** pane — showing decoded function calls, gas usage, event logs, and state changes.
- The agent watches the preview too — if a user action triggers a revert, the **Self-Healing Revert** loop kicks in automatically.

### 6. Post-Deploy Automation via KeeperHub

Once a contract is live (locally, on Sepolia, or on 0G Galileo), the agent connects to KeeperHub's hosted MCP and drives the platform directly:

- The agent calls `keeperhub_list_action_schemas` to discover what action types KeeperHub exposes (web3 reads/writes, schedules, HTTP, IPFS, …) — the schemas are the source of truth, not a frozen client.
- For natural-language requests ("every hour, if `Vault.totalSupply()` > 1000, call `rebalance()`"), the agent uses `keeperhub_ai_generate_workflow` to draft a workflow, then `keeperhub_create_workflow` to persist it.
- `keeperhub_execute_workflow` fires the keeper; the agent surfaces the `executionId` so the user can follow it in the KeeperHub dashboard.
- For one-off calls or transfers, the direct-execution tools fire a single action without storing a workflow.
- KeeperHub deliberately doesn't provide a contract-creation action, so deployments still go through Crucible's `deploy_local` (Hardhat), `deploy_og_chain` (0G Galileo), or `deploy_sepolia` (Sepolia). The handoff is clean: Crucible deploys, KeeperHub automates.

---

## How It Compares

|                             | Remix           | ChainIDE | v0 (Vercel)         | **Crucible**                                                   |
| :-------------------------- | :-------------- | :------- | :------------------ | :------------------------------------------------------------- |
| **AI-Driven**               | No              | No       | Yes (frontend only) | **Yes (full-stack + chain)**                                   |
| **Local Chain**             | JS VM (limited) | Partial  | No                  | **Full Hardhat node (server-side)**                            |
| **Embedded Wallet**         | Yes (basic)     | No       | N/A                 | **Pre-funded, labeled, auto-synced**                           |
| **Live dApp Preview**       | No              | No       | Yes                 | **Yes, with chain injection**                                  |
| **Tx Inspector**            | Basic           | Basic    | No                  | **Decoded traces, events, on-chain state diffs**               |
| **Agent has chain context** | No              | No       | No                  | **Yes, via MCP**                                               |
| **Persistent agent memory** | No              | No       | No                  | **Yes, on 0G Storage (cross-session, cross-node)**             |
| **Peer knowledge mesh**     | No              | No       | No                  | **Yes, via Gensyn AXL**                                        |
| **Self-Healing Reverts**    | No              | No       | No                  | **Recall → mesh → patch → verify → remember**                  |
| **Ship to public chains**   | Manual          | Manual   | N/A                 | **Deploy to 0G Galileo or Sepolia + KeeperHub automation MCP** |

---

## AI Tool Attribution

We practiced **spec-driven development** for this project. Our human-authored architecture documents, planning files, and task lists served as the strict specifications. We then used AI as a general pair programmer throughout the entire codebase to implement those specs.

Specific AI tool usage includes:

- **GitHub Copilot** — Context-aware completion and scaffolding in `packages/agent/`, `packages/mcp-devtools/`, `packages/mcp-wallet/`, and `packages/mcp-chain/`.
- **Zed** — Refactoring, doc updates, and small or low-level feature implementation in `packages/backend/`, `packages/frontend/`, `packages/mcp-deployer/`, and `docs/`.

---

## Tech Stack

| Layer                    | Choice                                            | Notes                                                                                             |
| :----------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------ |
| **Runtime**              | Bun 1.3.x                                         | Native TS execution, no build step; Hardhat is the only exception (spawned via `node`)            |
| **Language**             | TypeScript 6.x                                    | Bun runs `.ts` directly                                                                           |
| **Build orchestration**  | Turborepo 2.x                                     | Task graph, remote cache                                                                          |
| **Local DX routing**     | Portless                                          | Stable `.localhost` URLs instead of hardcoded ports                                               |
| **Backend HTTP/WS**      | Hono 4.x (Bun adapter)                            | Built-in WS upgrade via `hono/ws`                                                                 |
| **MCP SDK**              | `@modelcontextprotocol/sdk`                       | HTTP transport, Zod-validated tools                                                               |
| **Frontend**             | SvelteKit 2.x                                     | Reactive stores for agent event streaming                                                         |
| **Editor**               | CodeMirror 6.x                                    | `@codemirror/lang-solidity`                                                                       |
| **Terminal UI**          | xterm.js v6.0.0 (browser) + docker exec (backend) | Real PTY via Docker hijack; bash runs inside workspace runtime container, I/O over WebSocket      |
| **Chain libraries**      | viem 2.x                                          | Full TS types for ABIs, actions, accounts                                                         |
| **Local chain**          | Hardhat 2.22+                                     | Fork, snapshots, `hardhat_getTransactionTrace`                                                    |
| **Solidity compiler**    | solc-js 0.8.x                                     | Backend-only, never in browser                                                                    |
| **Inference**            | 0G Compute primary + OpenAI-compatible fallback   | 0G is the default/judged path with verifiable receipts; fallback is for degraded public beta only |
| **Persistent memory**    | 0G Storage (KV + Log)                             | KV = recall index; Log = full history                                                             |
| **Peer mesh**            | Gensyn AXL node binary                            | Separate process per backend instance                                                             |
| **Production execution** | KeeperHub MCP                                     | Only public-chain path, no exceptions                                                             |
| **Validation**           | Zod 3.x                                           | All MCP tool args + HTTP request bodies                                                           |
| **Testing**              | Vitest 4.x                                        | ESM, viem, SvelteKit compatible                                                                   |

We intentionally do **not** run the programming runtime inside WebContainers. Hardhat tracing, long-lived chain state, and the AXL node all require real backend-managed processes. The browser renders the development surface; the backend owns the runtime.

Fallback policy: **0G Compute is always the primary inference provider**. The OpenAI-compatible fallback exists only so demos and public testing do not hard-fail when 0G credits are exhausted, a provider is rate-limited, or the service is temporarily unavailable. When fallback is active, the UI must show the active provider clearly.

---

## End-to-End UX

### 1. Open a Workspace

The user lands on `https://crucible.localhost` and either creates or reopens a workspace. The backend creates `/workspace/{workspaceId}/`, starts the local chain, boots the AXL node, restores the workspace files, opens a PTY terminal session, and returns the workspace state.

### 2. Prompt the Agent

The user types a prompt such as _"Build me a token vault with deposit, withdraw, and a 24-hour withdrawal cooldown."_ The agent receives the prompt plus the current workspace context, calls the inference router (0G Compute primary; OpenAI-compatible fallback only in degraded mode), and begins emitting visible tool activity.

### 3. Watch Code Appear

The agent writes real files into the workspace directory. CodeMirror updates as files change. Compilation runs against those same files on disk, so the editor, compiler, deployer, and preview are always looking at the same project state.

### 4. See the App Running

The backend starts or refreshes the workspace preview server, and the preview pane loads the app from its own Portless URL. The preview bootstraps with its own EIP-1193 bridge, and local RPC access is routed through the parent shell, so the user can click buttons immediately without a browser extension.

### 5. Inspect What Happened

Every important system surface is visible:

- **Editor:** current source files
- **Preview:** live dApp UI
- **Inspector:** decoded transactions, traces, events, active inference provider, and receipts when available
- **Terminal:** compiler output, deploy logs, agent progress, and manual shell access

### 6. Recover from Failure

If a transaction reverts, the agent traces it, checks shared memory, asks the mesh if needed, verifies a patch in a snapshot, updates the workspace files, and explains what changed. The user sees the full sequence in the inspector and terminal instead of a single magic success message.

### 7. Automate It With KeeperHub

Once the contract is deployed (locally or to 0G Galileo), the agent uses KeeperHub's hosted MCP to wire keepers and on-chain automation. The user can ask in natural language — _"every hour, if `Vault.totalSupply()` > 1000, call `rebalance()`"_ — and the agent calls `keeperhub_ai_generate_workflow`, reviews the draft, and creates + executes the workflow against the deployed address. Execution IDs link back to the KeeperHub dashboard.

---

## The Demo (4 Minutes)

The narrative is one continuous build → break → heal → ship arc:

1. **(0:00–0:25)** Problem slide + three sponsor logos. _"Web3 dev is 5 disconnected tools and an AI that can't see your chain."_
2. **(0:25–1:15)** **Build.** User prompts: _"Build me a token vault with deposit, withdraw, and a 24-hour withdrawal cooldown."_ Agent writes contracts and frontend, compiles, deploys to local Hardhat, renders the live dApp. **Inspector shows a verifiable inference receipt from 0G Compute.**
3. **(1:15–2:30)** **Break and Heal — the money shot.** User triggers a withdraw before the cooldown elapses. Tx reverts.
   - Inspector shows the trace.
   - `memory-mcp.recall()` → no local hit. _"Asking the mesh."_
   - **Cut to a second laptop** running Crucible, also on AXL. Its agent solved this exact pattern yesterday. It responds with the patch + verification receipt.
   - Local agent verifies the patch in a snapshot. Withdraw succeeds.
   - `memory-mcp.remember()` writes the verified pattern back to 0G Storage. _"Now everyone benefits."_
4. **(2:30–3:30)** **Deploy + Automate.** User asks the agent to deploy to Sepolia. `deploy_sepolia` returns an Etherscan Sepolia link. Then: _"Set up a keeper that calls `harvest()` every hour."_ Agent calls `keeperhub_list_action_schemas`, then `keeperhub_get_wallet_integration` for chain `11155111`, then `keeperhub_ai_generate_workflow` with the natural-language description, then `keeperhub_create_workflow` and `keeperhub_execute_workflow`. The Inspector shows each `keeperhub_*` tool call and the returned `executionId` linked to the KeeperHub dashboard.
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

## Devcontainer

Crucible includes a VS Code devcontainer with a local Postgres service for
workspace metadata and backend development.

### Start

1. Open the repository in VS Code.
2. Run "Dev Containers: Reopen in Container".
3. Wait for container startup and the Bun setup + `bun install` post-create step.

### Verify Bun

Run these commands in the integrated terminal:

```bash
bun --version
bun --revision
```

If you see `command not found: bun`, reload your shell config and retry:

```bash
source ~/.zshrc   # or: source ~/.bashrc
bun --version
```

### Local database defaults

Inside the devcontainer, the workspace service exposes:

```text
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/crucible
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=crucible
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

### Troubleshooting

- If you see `docker-credential-desktop: executable file not found`, fix your
  host Docker config by removing `"credsStore": "desktop"` from
  `~/.docker/config.json`.
- If your Docker tooling warns about missing buildx, this devcontainer setup
  avoids image build steps by using prebuilt images.
- Bun is installed via the official script (`https://bun.com/install`) during
  `postCreateCommand`, and PATH entries are added to both `~/.zshrc` and
  `~/.bashrc`.

## Docs

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — MCP server specs, type contracts, WebSocket channels, monorepo structure
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Live hosting architecture, Docker strategy, laptop hosting plan, AWS migration path
- **[TRACKS.md](./TRACKS.md)** — Sponsor alignment, prize strategy, submission requirements per track
- **[PLAN.md](./PLAN.md)** — 14-day build plan, team division, integration checkpoints, stub strategy

---

_Describe it. Watch it build. Ship it._
