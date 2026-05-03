# Plan — Decoupled Build Strategy, Proofs of Value & Decision Gates

> The hackathon runs **9 days** (April 24 – May 3, 2026, deadline **noon EDT**). This plan is intentionally not package-first. The earlier version coupled sponsor integrations, implementation packages, and demo beats into the same milestones, which made it too easy to finish a lot of code without proving the product thesis.

This version separates four things that must not be conflated:

1. Product proofs of value
2. Frozen interface contracts
3. Team ownership
4. Sponsor-specific integrations

The rule for the whole build: no milestone is considered done because a package exists. A milestone is done only when a user-visible proof works end-to-end behind a stable contract.

---

## Current Implementation Snapshot (April 30, 2026)

What is actually wired on the working branch, not what is documented as the eventual shape.

| Layer                                     | Status     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :---------------------------------------- | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@crucible/types` contracts               | ✅ shipped | All boundary types (workspace / runtime / agent events / MCP I/O / preview bridge) are merged. `AgentEvent` now includes `message_delta` for token-by-token streaming.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Postgres metadata via Prisma              | ✅ shipped | `workspace`, `workspace_runtime`, `walletAddress`, plus better-auth tables. Seven migrations applied (latest adds `memoryPort` + `devtoolsPort`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Auth (better-auth + SIWE)                 | ✅ shipped | **SIWE** (`better-auth/plugins/siwe`) is the primary path; Google OAuth optional. Anonymous plugin removed. EOA-only verification via viem's `verifyMessage`. All routes 401-gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Per-workspace Docker runner               | ✅ shipped | `crucible-runtime:latest` image, dockerode supervisor, dynamic host ports, bind/volume mounts, readiness probe, status reconciliation. `entrypoint.sh` supervises every MCP service with a per-service restart loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Runtime MCP servers (in container)        | ✅ shipped | `mcp-chain` (3100), `mcp-compiler` (3101), `mcp-deployer` (3102), `mcp-wallet` (3103), `mcp-memory` (3104), `mcp-terminal` (3106), and the in-runner `mcp-devtools` sidecar (3107) all baked into the runner image and supervised by `entrypoint.sh`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Control-plane `tool_exec` proxy           | ✅ shipped | HTTP proxy routes `chain` / `compiler` / `deployer` / `wallet` / `memory` / `terminal` / `mesh` to in-container ports. All seven servers routed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@crucible/agent`                         | ✅ shipped | AI SDK v6 agentic loop, MCP client per server, system prompt with full tool docs. `POST /api/prompt` calls `runAgentTurn`, publishes events to SSE bus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Frontend shell                            | ✅ shipped | SvelteKit 2 + Svelte 5; chat rail / editor / preview / terminal panes; SSE agent stream; workspace boot polling; SIWE login; preview pane iframes `previewUrl` when set; model picker in chat rail surfaces 0G + OpenAI-compatible providers from `GET /api/models`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Workspace list UI + `GET /api/workspaces` | ✅ shipped | Sidebar lists authenticated user's workspaces with last runtime status; rows are `WorkspaceSummary`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/ws/terminal` (browser PTY)              | ✅ shipped | Backend: `docker exec -it` hijack, `getOrCreatePtySession`, `terminalSessionId` persisted. Frontend: `terminal-pane.svelte` with xterm.js v6.0.0, FitAddon, full WebSocket bridge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mcp-terminal` (agent-callable)           | ✅ shipped | In-container MCP server (`packages/mcp-terminal`, port 3106). Exposes `create_session`, `write`, `exec`, `resize` tools. `exec` spawns a transient non-interactive subprocess — never touches the user's browser PTY. `tool_exec` for `terminal` now routed correctly via `tool-exec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Chat sessions                             | ✅ shipped | Multi-session JSONL persistence — each session lives at `.crucible/sessions/${sessionId}.jsonl`. Bus and chat-log keyed `${workspaceId}:${sessionId}` so events never bleed across sessions. Token deltas coalesced on flush. REST: `GET/POST /sessions`, `PATCH/DELETE /sessions/:id`. Frontend: per-session tab bar with rename / delete, `hydrate` on switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Preview supervisor                        | ✅ shipped | `preview-manager.ts` starts a per-workspace Vite dev server, assigns a free port, persists `previewUrl` to DB. Called on workspace create and runtime start.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| EIP-1193 bridge                           | ✅ shipped | `buildBridgeScript()` generates + injects `/__crucible/preview-bridge.js`. Three-layer protocol: bridge IIFE → shell `eip1193-bridge.ts` → `POST /workspace/:id/rpc` → mcp-chain `/json-rpc` → Hardhat. EIP-6963 announce included.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Inference router (0G primary)             | ✅ shipped | 0G Compute primary via the OpenAI-compatible Compute Router (`OG_API_KEY` + `OG_MODEL`), with `x_0g_trace` captured into `InferenceReceipt.attestation`; OpenAI-compatible fallback; classified `FallbackReason` surfaced on the receipt + `error` events; UI shows provider badge with click-to-expand trace and one-click "retry with fallback".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mcp-memory` durability (0G Storage)      | ✅ shipped | `KvClient` from `@0gfoundation/0g-storage-ts-sdk` wired in `service.ts`. Activates when `OG_STORAGE_PRIVATE_KEY` + `OG_STORAGE_KV_URL` are set; falls back to local FS. Cross-session persistence works when creds are present.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `deploy_og_chain` (0G Chain)              | ✅ shipped | viem + OG_TESTNET_CHAIN (chainId 16602) in `mcp-deployer`. System prompt routes 0G deploys away from `chain.start_node`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Self-healing repair loop                  | ✅ shipped | 7-phase forced repair on revert (`snapshot → trace → recall → patch → compile → revert → deploy → resume`). `prepareStep` constrains active tools + forces tool choice per phase. Emits `revert_detected / trace_captured / memory_recall / patch_proposed / patch_verified / repair_failed`. 3-attempt cap; compile failure loops back to `patch`. Validated on glm-5, minimax-b2.5, deepseek-v4-pro.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Autopilot                                 | ✅ shipped | `⚡ auto` toggle in chat rail. Auto-sends `"continue"` after any turn with tool calls; stops on text-only response. Prevents need to re-prompt mid-task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `mcp-mesh` (AXL)                          | ✅ shipped | `packages/mcp-mesh` fully implemented: `AXLNodeManager` (`node-manager.ts`) handles ed25519 identity key generation, AXL binary lifecycle, background recv-poll loop, and in-memory response queuing. `axl-client.ts` wraps the AXL HTTP API. `server.ts` exposes five MCP tools (`list_peers`, `broadcast_help`, `collect_responses`, `respond`, `verify_peer_patch`). In-container MCP server on port 3105; `tool-exec.ts` MESH_ROUTES proxy wired. Backend AXL key registry (`POST /workspace/{id}/axl-key`, `GET /workspace/{id}/mesh-peers`) persists and returns per-workspace AXL public keys. Event-row renderers for `mesh_help_broadcast` and `mesh_help_received` shipped. **Remaining:** dedicated frontend mesh panel (live peer list / requests / responses), same-machine dual-workspace proof, two-laptop proof, POV-3 demo. |
| KeeperHub `ship` adapter                  | ✅ shipped | `POST /api/ship` endpoint (simulate → execute → background poll → persist). `simulate_bundle` / `execute_tx` / `get_execution_status` MCP tools in `mcp-deployer`. `ship_simulated` / `ship_status` / `ship_confirmed` `AgentEvent` types emitted with `sessionId` scoping. Sepolia contract address persisted to workspace `deployments` column. No `eth_sendRawTransaction` in the KeeperHub path. Frontend event rows (`ship-simulated-row`, `ship-status-row`, `ship-confirmed-row`) all rendered in inspector with gas table, live status, and clickable audit trail link. Sepolia end-to-end validated with a real `KEEPERHUB_API_KEY`. **Remaining:** standalone Ship button in frontend UI (no `workspaceClient.ship()` call yet; ship events surface via SSE but user cannot trigger a ship from the workspace page).               |
| Portless preview origin                   | 🔴 missing | Preview URL is `http://localhost:<port>` today. Caddy + subdomain routing (`preview.<id>.crucible.localhost`) still planned for Phase 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Gateway / TLS                             | 🔴 missing | Single host. Caddy + cloudflared still planned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Current status (May 3, submission day):** POV-1, POV-2, and POV-3 (code path) are complete. `mcp-mesh` is fully shipped — AXL node lifecycle, all five mesh tools, tool-exec proxy, and backend key registry are all wired. POV-4 (KeeperHub ship) is complete on the backend with Sepolia end-to-end validated; the remaining gap is a standalone Ship button in the frontend (no `workspaceClient.ship()` call exists yet, so ship events only surface when triggered server-side). The self-healing repair loop is shipped and validated on glm-5, minimax-b2.5, and deepseek-v4-pro. DemoVault scaffold is in place. Critical path for submission: Ship button UI, demo video, submission form, and AI tool attribution in README.

---

## Planning Principles

1. **Prove the product before polishing the architecture.** The first thing to validate is not 0G, AXL, or KeeperHub depth. It is whether Crucible is meaningfully better than "chat plus editor plus wallet plus terminal" because the runtime is inspectable and the loop is coherent.
2. **One risky integration per phase.** A phase can introduce either a new runtime dependency, a new network dependency, or a new sponsor dependency, but not all three at once.
3. **Local loop first, network effects second.** Mesh, memory, and shipping are multipliers. The local prompt -> build -> click loop must be valuable without them.
4. **Contracts freeze early; implementations stay swappable.** `packages/types` freezes on Day 0. Everything else can change behind those contracts.
5. **The runtime boundary is sacred.** Control plane and workspace runtime must talk through a narrow contract so the same product can run either as host child processes or isolated runner containers.
6. **Every sponsor integration must degrade honestly.** 0G fallback must be visible, mesh must be optional, and shipping must be a separate path from the local dev loop.
7. **UI surfaces are trust surfaces.** Terminal, preview, inspector, and event stream are not polish tasks. They are how the product earns credibility.

---

## Compliance Checklist

Non-negotiable requirements from the ETHGlobal Open Agents rules. All must be satisfied before submission on May 3.

- [ ] **AI tool attribution**: Document AI tool usage (GitHub Copilot, Cursor, etc.) in the README, specifying which files or parts were AI-assisted. Required for partner prize eligibility.
- [ ] **`FEEDBACK.md` in repo root**: Required to qualify for KeeperHub Builder Feedback Bounty ($500). Must be specific and actionable — cover UX friction, reproducible bugs, documentation gaps, or feature requests encountered during integration.
- [ ] **Contract deployment addresses on 0G Chain**: Both 0G tracks require actual deployment addresses (not local Hardhat). `mcp-deployer` must target 0G Chain in addition to the local chain.
- [ ] **AXL cross-process**: Gensyn requires communication across separate AXL node processes — not just in-process calls. Must demonstrate two independent AXL processes (same-machine dual-workspace first, then two-laptop).
- [ ] **Demo video 2–4 min**: ETHGlobal auto-rejects videos under 2 min or over 4 min. No AI voiceover. Minimum 720p. 0G specifically asks for under 3 min — cut a separate ≤3-min 0G-focused version from the main demo.
- [ ] **Incremental commit history**: Large single commits may trigger disqualification. Keep commits small and purposeful throughout the remaining 7 days.
- [ ] **Select up to 3 Partner Prizes on submission form**: 0G counts as 1 slot even across both tracks. Slots: 0G (1), Gensyn (2), KeeperHub (3).

---

## Proof Order

These are the product proofs of value. They determine build order.

### POV-1: Inspectable Local Build Loop

**Question:** If a user describes a dApp, can Crucible build it in a way that feels inspectable instead of magical?

**Must prove:**

- Prompt accepted by the agent
- Real files written into a workspace
- Compile and deploy against a real local chain
- Preview loads from its own origin
- User clicks a button in the preview and sees the result
- Terminal and inspector show enough evidence to trust what happened

**What is explicitly not required yet:**

- Mesh
- KeeperHub
- Production deployment
- Fully autonomous self-healing

### POV-2: Trustworthy Self-Healing

**Question:** Does the revert-repair loop materially reduce debugging time, or is it just a theatrical agent demo?

**Must prove:**

- Revert is detected
- Trace is readable enough for diagnosis
- Agent recalls prior pattern or reasons from the trace
- Patch is verified against a snapshot before commit
- Successful fix is written back to memory

**Important:** This proof must work without AXL first. Mesh is not allowed to hide the fact that the local healing loop is weak.

### POV-3: Mesh Adds Real Value

**Question:** Does AXL improve the fix loop beyond what local memory and local reasoning already do?

**Must prove:**

- Local agent misses a known pattern
- Peer supplies a candidate patch or strong hint
- Local agent verifies it before apply
- User can inspect where the fix came from

**Important:** Mesh must be additive, not load-bearing for the core product.

### POV-4: Ship Is a Separate, Trustworthy Path

**Question:** Can the exact artifact proven locally be shipped to a public chain through one controlled execution path?

**Must prove:**

- Local build state is explicit and reproducible
- Ship action invokes KeeperHub and only KeeperHub for public-chain execution
- Simulation, execution, retry, and audit trail are visible in the inspector

### POV-5: Hosted Runtime Preserves the Mental Model

**Question:** Does the product still behave the same way when the workspace runtime moves out of the main app process?

**Must prove:**

- Control plane can target a workspace runtime without knowing whether it is local or containerized
- Preview URL, terminal session, and tool calls still work through the same contracts
- Cold starts and reconnects are understandable to a tester

---

## Frozen Contracts

Only one thing truly freezes on Day 0: the type contracts. Everything else stays replaceable.

| Boundary                            | Contract                                                                                     | Why it must freeze early                                           |
| :---------------------------------- | :------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| Frontend <-> backend                | `WorkspaceState`, `PromptRequest`, `ShipResponse`, `AgentEvent` stream                       | Lets UI, backend, and agent move independently                     |
| Agent <-> MCP tools                 | Zod-validated tool schemas in `packages/types`                                               | Prevents direct package imports and hidden coupling                |
| Control plane <-> workspace runtime | `open_workspace`, `runtime_status`, `preview_url`, terminal session, tool execution envelope | Keeps child-process mode and runner-container mode interchangeable |
| Preview <-> shell                   | Exact-origin message contract for EIP-1193 bridging                                          | Avoids preview-specific hacks leaking into the app shell           |
| Memory layer <-> agent              | `recall`, `remember`, `list_patterns`, `provenance`                                          | Lets local fixtures and 0G backends share one interface            |
| Mesh layer <-> agent                | `list_peers`, `broadcast_help`, `collect_responses`, `respond`, `verify_peer_patch`          | Keeps AXL optional until the mesh proof phase                      |
| Shipping layer <-> agent            | `simulate_bundle`, `execute_tx`, `get_execution_status`                                      | Keeps public-chain execution isolated from local-chain logic       |
| Inference layer <-> agent           | provider adapter result including receipt metadata and degraded-mode flag                    | Makes 0G primary while keeping fallback honest                     |

### Non-Negotiable Architectural Rules

- No package imports from another package's `src/`
- No direct frontend knowledge of internal MCP service locations
- No direct agent access to Hardhat, PTY, or preview internals except through typed tools or runtime contracts
- No public-chain transaction path outside KeeperHub
- No mesh dependency in the core local loop

---

## Team Ownership

Ownership is by capability, not by milestone. A capability owner keeps the contract healthy and unblocks others with fixtures.

| Domain                  | Primary owner | Main packages                                                                                                                              | Responsibility                                                                                          |
| :---------------------- | :------------ | :----------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| Runtime substrate       | **Dev A**     | `packages/backend`, `packages/mcp-chain`, `packages/mcp-compiler`, `packages/mcp-deployer`, `packages/mcp-wallet`, `packages/mcp-terminal` | Real workspace runtime, chain, terminal, preview, and runtime contract                                  |
| Agent and memory        | **Dev B**     | `packages/agent`, `packages/mcp-memory`                                                                                                    | Planning loop, inference routing, memory loop, event stream, and repair orchestration                   |
| Trust surfaces and mesh | **Dev C**     | `packages/frontend`, `packages/mcp-mesh`                                                                                                   | UI trust surfaces, typed event rendering, terminal/preview integration, mesh UX, and peer collaboration |
| Shared contracts        | **All three** | `packages/types`                                                                                                                           | Schemas, event unions, runtime envelopes, and fixture compatibility                                     |

### Team Rule

No domain owner is allowed to block the others with unfinished real integrations. If the real thing is not ready, they must provide a fixture or mock that conforms to the frozen contract.

---

## Phase Plan

The plan is phased by proof, not by package completion.

### Phase 0 — Freeze Contracts and Stub Every Boundary

**Days 0-1 (April 24-25) — ✅ Complete**

**Goal:** Make every team member independently productive behind stable contracts.

**Required outputs:**

- `packages/types` merged and treated as frozen
- Fixture payloads for every `AgentEvent` variant
- Mock runtime contract returning `WorkspaceState`, `previewUrl`, and `terminalSessionId`
- Mock MCP responses for chain, compiler, deployer, wallet, memory, mesh, and ship
- A single source of truth for dev env flags such as `MOCK_RUNTIME`, `MOCK_MEMORY`, `MOCK_MESH`, `MOCK_SHIP`, `MOCK_INFERENCE`

**Gate:** By end of Day 1, every domain can build against typed fixtures without waiting on another domain.

### Phase 1 — Prove POV-1: Inspectable Local Loop

**Days 2-4 (April 26-28) — 🟢 Infrastructure landed; final gate is the end-to-end smoke**

**Goal:** Make one thin vertical slice work locally without any sponsor dependency beyond what is required for the agent to answer.

**Status (April 30):**

- ✅ Real workspace directory creation and persistence (`provisionWorkspaceDirectory`, host bind-mount).
- ✅ Postgres metadata + better-auth session gating on every API route. Auth flipped from anonymous → **SIWE** (`better-auth/plugins/siwe`); login is wallet-driven via injected EIP-1193 provider, with Google OAuth still optional.
- ✅ Per-workspace Docker runner container (`crucible-runtime:latest`) with `mcp-chain`, `mcp-compiler`, `mcp-deployer`, `mcp-wallet`, `mcp-memory`, `mcp-terminal`, and the in-runner `mcp-devtools` observability sidecar all supervised inside.
- ✅ Control-plane HTTP proxy from `tool_exec` to in-container chain / compiler / deployer / wallet / memory / terminal services with dynamic host port discovery. Only `mesh` remains unrouted.
- ✅ Frontend shell with editor / preview / terminal / chat-rail / status-bar; agent SSE wired (`/api/agent/stream`); `/workspaces/[id]` polls boot status; `/workspaces` list with sidebar; SIWE login page.
- ✅ Real local chain lifecycle (`start_node`, snapshot, revert, mine, fork) and local deploy (`mcp-deployer.deploy_local` resolving bytecode from `mcp-compiler` via `COMPILER_URL`, signing with a wallet from `mcp-wallet`).
- ✅ Agent loop — `@crucible/agent` ships using AI SDK v6 + `@ai-sdk/mcp createMCPClient`, dispatches tools across the in-runner MCP servers, and streams `message_delta` tokens onto the SSE bus.
- ✅ PTY session reachable from browser — `/ws/terminal?workspaceId=<id>` get-or-creates an interactive bash inside `crucible-ws-<id>` via `docker exec` (Tty=true), persisted on `workspaceRuntime.terminalSessionId`.
- ✅ `mcp-terminal` (agent-callable shell) — `packages/mcp-terminal` baked into the runner image; `exec` / `write` / `resize` tools dispatched through `tool-exec.ts` to port 3106. Spawns transient non-interactive `bash -c` subprocesses; the browser PTY is untouched.
- ✅ `mcp-devtools` observability — in-runner sink for tool-call/result/container events; SSE'd to the frontend via `GET /api/workspace/:id/devtools/events`.
- ✅ Preview supervisor + EIP-1193 bridge — per-workspace Vite dev server, injected `/__crucible/preview-bridge.js`, three-layer postMessage protocol with `POST /workspace/:id/rpc` proxying to `mcp-chain /json-rpc`. Caddy preview-subdomain origin still pending (Phase 5).

**Closing Phase 1 means landing, in priority order:**

1. End-to-end smoke: a real prompt → agent writes contract → compile → deploy → preview click on a generated frontend, fully exercised on `main`.
2. Portless preview origin (`https://preview.<workspaceId>.crucible.localhost`) so the bridge IIFE can drop the `'*'` `targetOrigin` workaround flagged in `preview-manager.ts`.

**Success demo:** User prompts a very small app such as a token minter or counter contract, the agent builds it, and the user clicks the preview successfully.

**What stays stubbed if necessary:**

- 0G receipts can be simulated if inference transport is not ready yet
- Trace rendering can stay skeletal
- Mesh and KeeperHub remain disabled

**Kill criteria:** If this is not working by Day 4, drop any Week 1 mesh work and narrow the demo scope to one contract + one frontend flow.

### Phase 2 — Prove POV-2: Self-Healing Without Mesh

**Days 4-5 (April 28-29)**

**Goal:** Validate the repair loop locally before adding networked collaboration.

**Required outputs:**

- Stable snapshot and revert flow
- Trace tool good enough to explain a real revert
- Memory `recall` and `remember` round-trip behind the MCP boundary
- Agent repair loop that patches code, redeploys to a snapshot, verifies, and only then commits
- UI evidence that explains the before/after state and the repair source

**Success demo:** A seeded revert such as allowance failure or cooldown violation is fixed end-to-end without any mesh help.

**Kill criteria:** If local verification is flaky by Day 7, mesh is downgraded to suggestion-only. No remote patch auto-apply.

### Phase 3 — Prove POV-3: Mesh Adds Value

**Days 5-7 (April 29 – May 1) ⚠️ Compressed — highest risk phase**

**Goal:** Add peer collaboration only after the local loop and local repair loop are credible.

**Required outputs:**

- AXL node lifecycle under `mcp-mesh`
- Structured help requests and responses
- Verification of peer-submitted patches before apply
- Mesh panel showing peer list, requests, responses, and provenance
- Same-machine dual-workspace proof before two-laptop proof

**Success demo:** Local agent misses a pattern, peer responds with a candidate fix, local agent verifies it, and the user sees both the provenance and the applied patch.

**Kill criteria:** If two-machine mesh is unreliable by Day 10, keep the mesh truthful but narrower: manual accept on remote suggestions, one pre-warmed peer, no claim of full autonomous cross-node recovery.

### Phase 4 — Prove POV-4: Ship Path

**Days 7-8 (May 1-2) — 🟢 Backend shipped; frontend UI pending**

**Goal:** Keep public-chain execution isolated from the local development loop and make KeeperHub the only public-chain path.

**Status:**

- ✅ `POST /api/ship` wired to KeeperHub only — phases: simulate → (optional) execute → background poll → persist.
- ✅ `simulate_bundle`, `execute_tx`, `get_execution_status` MCP tools registered in `mcp-deployer/server.ts`; `keeperhub-client.ts` handles exponential back-off and status enum mapping.
- ✅ `ship_simulated` / `ship_status` / `ship_confirmed` `AgentEvent` types emitted from the backend with `sessionId` scoping.
- ✅ Sepolia contract address persisted to workspace `deployments` DB column on confirmed deploy; `auditTrailId` captured.
- ✅ Auth-gated: `requireSession` + workspace ownership check in `POST /api/ship`.
- ✅ No `eth_sendRawTransaction` to a public RPC anywhere in the KeeperHub path.
- 🔴 Frontend Ship button / dedicated inspector panel not yet wired — ship events appear in the chat stream (event rows are rendered) but there is no standalone "Ship" button that posts to `/api/ship` from the UI.\n- 🔴 Sepolia end-to-end path not validated with a real `KEEPERHUB_API_KEY` on testnet.

**Success demo:** User clicks Ship, sees KeeperHub simulation, execution status, and audit trail for the exact artifact that just ran locally.

**Kill criteria:** If shipping is unstable by Day 12, freeze scope to Sepolia, one contract archetype, and no live post-deploy interactions from the public preview.

### Phase 5 — Prove POV-5: Hosted Runtime and Demo Hardening

**Partially landed early. Remaining scope: post-hackathon.**

> Originally planned as post-hackathon. The control-plane / runner-container split actually shipped in Phase 1 because building the runner-in-Docker first turned out to be cheaper than threading "child process or container" everywhere. What remains is gateway, AXL sidecar, and the operator polish.

**Already done:**

- Control plane / workspace runner boundary is the **only** runtime path on `main`. `runtime-docker.ts` spawns one `crucible-runtime` container per workspace, dynamic host port mapping, bind or named-volume mounts, readiness probe, restart-policy reconciliation.
- Cold-start works: `POST /api/workspace` returns immediately, the UI polls `GET /api/workspace/:id` every 2s while the container boots, status flips `starting → ready | degraded | crashed`.
- Tool calls survive a runner restart: `runtime_status` re-discovers published ports.

**Still required (post-hackathon unless trivially cheap):**

- Gateway container (Caddy / Traefik) for TLS termination + preview-subdomain routing.
- AXL sidecar container alongside the control plane.
- Docker Compose top-level stack (gateway + control plane + AXL + cloudflared) — workspace runners stay dynamic.
- Operator playbook covering cold start times, idle eviction, max active workspaces, and inference-budget kill switch.

**Success demo:** External tester opens a hosted workspace, waits through a cold start, and still sees the same preview, terminal, and agent model as in local demo mode.

**Kill criteria:** If runner isolation threatens demo stability, freeze the gateway / sidecar work and run the judged demo against a locally-bound control plane talking to the same per-workspace runners on `127.0.0.1`.

---

## Integration Checkpoints

These are go/no-go gates, not status ceremonies.

| Day / Date          | Gate                  | What must work                                                     | Why it matters                       | Who verifies                   |
| :------------------ | :-------------------- | :----------------------------------------------------------------- | :----------------------------------- | :----------------------------- |
| **0** (Apr 24) ✅   | Contracts frozen      | `packages/types` merged, fixtures compile everywhere               | Decouples team execution             | All                            |
| **2** (Apr 26)      | Stub loop visible     | UI renders fixture events, mock workspace opens, terminal attaches | Team can iterate in parallel         | Each owner self-tests          |
| **4** (Apr 28)      | POV-1 green           | Prompt → files → compile → deploy → preview click                  | Proves the core product loop         | Dev B drives, Dev A + C verify |
| **5** (Apr 29)      | Local heal green      | Revert → trace → patch → verify → remember, no mesh                | Proves repair loop is not theater    | Dev B drives                   |
| **6** (Apr 30)      | Memory + 0G inference | 0G Compute routing visible in UI; recall round-trip on 0G Storage  | Proves 0G integrations have value    | Dev B + A verify               |
| **7** (May 1)       | Mesh additive         | AXL cross-process peer response verified before apply              | Proves AXL adds real value           | Dev C drives                   |
| **8** (May 2)       | Ship green            | KeeperHub simulation + execution + audit visible for Sepolia       | Proves the public-chain story        | Dev B drives                   |
| **8** (May 2)       | Full arc green        | Build → break → heal → ship in one sitting                         | Confirms the demo narrative          | All                            |
| **8** (May 2)       | Two-laptop rehearsal  | Separate AXL processes on separate machines                        | Proves cross-node honesty for Gensyn | Dev C leads                    |
| **9** (May 3, noon) | Record and submit     | Demo video (2–4 min) + 0G cut (≤3 min) + submission form           | Locks the deliverable                | All                            |

---

## Stub Strategy

Stubs are not temporary hacks. They are how we keep the build decoupled.

| Boundary          | Stub artifact                                             | Purpose                                                                     |
| :---------------- | :-------------------------------------------------------- | :-------------------------------------------------------------------------- |
| Agent events      | `packages/frontend/src/lib/fixtures/agentEvents.json`     | Frontend can render every event union variant immediately                   |
| Workspace runtime | Mock `GET /api/workspace/:id` + fake preview/terminal IDs | Frontend and backend can wire the shell before the real runtime is stable   |
| Chain toolchain   | `--mock` mode for chain/compiler/deployer/wallet MCPs     | Agent can exercise planning loop before Hardhat is reliable                 |
| Memory            | Local fixture-backed `recall`/`remember` implementation   | Repair loop can be proven before 0G wiring is done                          |
| Mesh              | Fixture peer directory + canned help responses            | UI and orchestration can be built before AXL networking is live             |
| Ship              | KeeperHub fixture adapter                                 | Inspector and ship flow can be built before real execution is wired         |
| Inference         | Receipt-shaped fixture result                             | UI can handle receipts and degraded mode before real 0G transport is stable |

### Stub Rule

All stubs live in `src/fixtures/` and are gated out of production paths. Nothing in production imports a fixture directly.

---

## Scope Cuts in Priority Order

These are the first things to cut if time or stability slips.

1. **Hosted public beta before judged demo.** Keep single-host trusted mode for the recorded demo if needed.
2. **Remote auto-apply of peer patches.** Keep peer suggestions and local verification; require manual accept if necessary.
3. **Rich trace UI.** Preserve decoded revert reason and basic call tree before storage diff polish.
4. **Post-deploy live interactions through KeeperHub.** Keep Ship itself load-bearing even if ongoing live interaction support slips.
5. **Broad contract archetype coverage.** Nail one strong demo archetype before generalizing.
6. **Fork UX.** Keep the fork tool available internally, but do not spend schedule on UI polish for it unless the core arc is stable.
7. **Dynamic model selection.** One stable 0G path plus explicit fallback is enough for the hackathon.

---

## Explicit Non-Goals

These remain out of scope for the hackathon build:

- Uniswap API integration
- iNFT minting
- Mainnet deployment in the demo
- In-process fake mesh or "Fleet Mode"
- Browser-hosted runtime via WebContainers
- Extra chains beyond the one local loop and one public-chain target needed for the demo

---

## Post-Hackathon

Future directions after the hackathon:

- Reputation and signing for mesh patches
- iNFT-backed Crucible agent identities on 0G
- Multi-chain local runtimes beyond EVM
- Pair-programming workspaces over AXL
- Plugin system for custom MCP servers
- Mainnet shipping with hardware-wallet approval flows
