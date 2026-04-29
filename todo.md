# Crucible — Project Checklist

> Synthesized from `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/TRACKS.md`, `docs/DEPLOYMENT.md`, and `README.md`.
> Status reflects what is wired in the working directory (branch `feat/siwe-auth-and-auth-flow`).

---

## Phase 0 — Freeze Contracts & Stub Every Boundary ✅

- [x] `@crucible/types` merged and treated as frozen (all boundary types: workspace / runtime / agent events / MCP I/O / preview bridge)
- [x] Fixture payloads for every `AgentEvent` variant
- [x] Mock runtime contract returning `WorkspaceState`, `previewUrl`, and `terminalSessionId`
- [x] Single source of truth for dev env flags (`MOCK_RUNTIME`, `MOCK_MEMORY`, `MOCK_MESH`, `MOCK_SHIP`, `MOCK_INFERENCE`)

---

## Phase 1 — Prove POV-1: Inspectable Local Build Loop

### Infrastructure

- [x] Real workspace directory creation and persistence (`provisionWorkspaceDirectory`, host bind-mount)
- [x] Postgres metadata + better-auth session gating on every API route
- [x] Per-workspace Docker runner (`crucible-runtime:latest`) with `mcp-chain` + `mcp-compiler` supervised inside
- [x] Control-plane HTTP proxy from `tool_exec` to in-container chain / compiler services with dynamic host port discovery
- [x] Frontend shell — SvelteKit 2 + Svelte 5; chat rail / editor / preview / terminal panes; agent SSE wired (`/api/agent/stream`); workspace boot polling

### Auth

- [x] better-auth anonymous + Google sign-in
- [x] SIWE (Sign-In with Ethereum) — EIP-4361 flow via `better-auth/plugins/siwe` (this branch)
- [x] Login page with SIWE + Google buttons

### MCP Services (runner)

- [x] `mcp-chain` — in-container port 3100, `start_node`, snapshot, revert, mine, fork
- [x] `mcp-compiler` — in-container port 3101, compile, list artifacts, get bytecode
- [x] `mcp-deployer` — package implemented (deploy_local, simulate_local, trace, call); Dockerfile + entrypoint wired on port 3102; tool-exec proxy wired
- [x] `mcp-wallet` — package implemented (list_accounts, get_balance, sign_tx, send_tx_local, switch_account); Dockerfile + entrypoint wired on port 3103; tool-exec proxy wired
- [x] `mcp-memory` — package implemented (recall, remember, list_patterns, provenance); Dockerfile + entrypoint wired on port 3104; tool-exec proxy wired

### Agent

- [x] `@crucible/agent` — real agent loop using AI SDK v6 `streamText`, MCP client per server
- [x] `POST /api/prompt` inference endpoint — calls `runAgentTurn`, publishes events to SSE bus
- [x] Inference router — 0G Compute primary (`@0glabs/0g-serving-broker`), OpenAI-compatible fallback
- [x] `inference_receipt` event emitted (provider, fallback reason, token counts)
- [x] Agent SSE bus (`/api/agent/stream`)
- [x] System prompt with full tool documentation

### Terminal

- [x] PTY manager on control plane (`docker exec` hijack, `getOrCreatePtySession`, bash in workspace runtime)
- [x] `/ws/terminal` WebSocket endpoint implemented in backend (session attach, input, resize, exit, docker exec hijack)
- [x] Terminal WebSocket bridge wired in frontend (`terminal-pane.svelte` with xterm.js v6.0.0, FitAddon, dynamic imports)

### Preview

- [x] Preview supervisor (`preview-manager.ts`) — starts Vite dev server per workspace, persists `previewUrl` to DB
- [x] `startPreview` called from both workspace create and runtime start paths
- [x] Preview pane renders iframe when `previewUrl` is set
- [ ] EIP-1193 bridge — no `__crucible/preview-bridge.js` injected into preview HTML; `window.ethereum` not installed inside preview origin
- [ ] Portless / subdomain preview URL (currently `http://localhost:<port>`, not `https://preview.<id>.crucible.localhost`)

### POV-1 Success Gate

- [ ] End-to-end: user prompts → agent writes files → compile → deploy → preview loads → user clicks button in preview

---

## Phase 2 — Prove POV-2: Self-Healing Without Mesh

- [x] Snapshot and revert tools in `mcp-chain` (exposed to agent via tool-exec)
- [x] Trace tool in `mcp-deployer`
- [x] `recall` / `remember` round-trip in `mcp-memory` (local file-backed)
- [ ] 0G Storage wiring for `mcp-memory` (currently local filesystem; `RecallInput`, `RememberInput` types exist but 0G KV/Log backend not connected)
- [ ] Agent repair loop — agent reasoning path that: detects revert → traces → recalls → patches → redeploys to snapshot → verifies → commits
- [ ] UI evidence of before/after state and repair source (inspector panel, revert event rendering)
- [ ] POV-2 demo: seeded revert (allowance failure, cooldown violation) fixed end-to-end without mesh

---

## Phase 3 — Prove POV-3: Mesh Adds Real Value

- [ ] `packages/mcp-mesh` — AXL node lifecycle manager (package does not exist)
- [ ] AXL node binary integrated and started as a sidecar
- [ ] `list_peers` tool
- [ ] `broadcast_help` — structured help request: `{revert_signature, full_trace, contract_source, solc_version, ttl}`
- [ ] `collect_responses` — gather candidate patches + verification receipts from peers
- [ ] `respond` — answer another agent's help request with a verified patch
- [ ] `verify_peer_patch` — re-execute candidate in local Hardhat snapshot before apply
- [ ] Mesh panel in frontend (peer list, requests, responses, provenance)
- [ ] Same-machine dual-workspace mesh proof
- [ ] Two-laptop AXL cross-node proof (separate AXL processes on separate machines)
- [ ] POV-3 demo: local agent misses pattern → peer responds → local agent verifies → patch applied with provenance shown

---

## Phase 4 — Prove POV-4: Ship Path (KeeperHub)

- [ ] `packages/mcp-deployer` KeeperHub path — `simulate_bundle`, `execute_tx`, `get_execution_status` against public chain
- [ ] `POST /api/ship` endpoint — wired to KeeperHub only; no direct `eth_sendRawTransaction` to public RPC
- [ ] Simulation output surfaced in inspector (decoded per-tx gas estimate)
- [ ] Execution status shown live: `pending → mined → confirmed`
- [ ] Audit trail IDs visible and persisted (clickable link to KeeperHub provenance record)
- [ ] Sepolia deployment path working for at least one contract archetype
- [ ] Contract deployment addresses recorded on 0G Chain (required for 0G track submission)
- [ ] POV-4 demo: user clicks Ship → KeeperHub simulation → execution status → audit trail for same artifact that ran locally

---

## Phase 5 — Hosted Runtime & Demo Hardening

### Already done

- [x] Control plane / workspace runner boundary — only runtime path on `main`
- [x] `runtime-docker.ts` — create / start / inspect / stop / reconcile per-workspace containers
- [x] Cold-start polling loop — `starting → ready | degraded | crashed`
- [x] Tool calls survive runner restart — port re-discovery

### Still required (post-hackathon unless cheap)

- [ ] Gateway container (Caddy / Traefik) — TLS termination + preview-subdomain routing
- [ ] AXL sidecar container alongside control plane
- [ ] Docker Compose top-level stack (gateway + control plane + AXL + cloudflared)
- [ ] Cloudflare Tunnel for public ingress from laptop
- [ ] Operator playbook (cold start times, idle eviction, max workspaces, inference-budget kill switch)

---

## 0G Track Requirements

### Track 1 — Best Agent Framework, Tooling & Core Extensions

- [x] `@crucible/agent` as Web3-development OpenClaw extension
- [x] Web3 tool registry loading MCP servers by URL (chain, compiler, deployer, wallet, memory)
- [x] Solidity-aware code generation prompt templates with compiler error feedback
- [x] 0G Compute inference adapter (`og-adapter.ts`) — routes via `@0glabs/0g-serving-broker`, captures receipts
- [x] OpenAI-compatible fallback path — only active when 0G unavailable; degraded-mode flag in event
- [x] `mcp-memory` MCP interface abstracting 0G Storage KV (recall index) and Log (full history)
- [ ] 0G Storage backend wired into `mcp-memory` (currently local file-backed)
- [ ] Fallback mode visibly shown in UI when non-0G provider is active
- [ ] Contract deployment addresses on 0G Chain (required for 0G submission)
- [ ] Demo video ≤ 3 min (separate 0G-focused cut)
- [ ] Architecture diagram showing OpenClaw + 0G Storage/Compute integration
- [ ] Submission form: protocol features/SDKs used documented (0G Compute, 0G Storage KV + Log)

### Track 2 — Best Autonomous Agents, Swarms & iNFT Innovations

- [x] Persistent memory layer across sessions (via `mcp-memory`)
- [ ] 0G Storage backend for cross-session persistence
- [ ] Emergent mesh collaboration (requires `mcp-mesh` / AXL above)
- [ ] Cross-node knowledge sharing demo (revert signature → patch → verification receipt shared over AXL + 0G Storage)

---

## Gensyn Track — Best Application of AXL

- [ ] AXL node binary running per Crucible backend instance
- [ ] `mcp-mesh` package wrapping AXL node binary
- [ ] Peer discovery + `list_peers`
- [ ] Structured message format (not freeform chat) — `{revert_signature, full_trace, contract_source, solc_version, ttl}`
- [ ] `broadcast_help` + `collect_responses` + `respond` + `verify_peer_patch`
- [ ] **Cross-process AXL**: two independent AXL node processes (not in-process) — required by Gensyn rules
- [ ] Two-laptop demo: `axl status` on both machines proving independent peers
- [x] Code quality: Turborepo monorepo, TypeScript 6.x, ESLint 9 flat config, Vitest 4.x
- [ ] `ARCHITECTURE.md` section documenting `mcp-mesh` tool spec (update when implemented)

---

## KeeperHub Track — Best Use + Builder Feedback Bounty

- [ ] KeeperHub MCP client integrated in control plane
- [ ] `simulate_bundle()` — deployment + config txs pre-flight
- [ ] `execute_tx()` — with retry logic, gas optimization, private routing
- [ ] Audit trail IDs surfaced in inspector (clickable KeeperHub provenance link)
- [ ] Post-deploy interactions also routed through KeeperHub (not just initial deploy)
- [ ] No `eth_sendRawTransaction` to a public RPC anywhere in the codebase
- [ ] Sepolia path working end-to-end
- [ ] `FEEDBACK.md` in repo root — specific and actionable (UX friction, reproducible bugs, doc gaps, feature requests) — required for Builder Feedback Bounty ($500)

---

## ETHGlobal Submission Requirements

- [ ] **AI tool attribution** in README — document GitHub Copilot / Cursor usage, specify which files or parts were AI-assisted (required for partner prize eligibility)
- [ ] **`FEEDBACK.md`** in repo root (KeeperHub Builder Feedback Bounty — $500)
- [ ] **Contract deployment addresses on 0G Chain** — both 0G tracks require real addresses (not local Hardhat)
- [ ] **Cross-process AXL demo** — two independent AXL node processes (Gensyn requirement)
- [ ] **Demo video 2–4 min** — no AI voiceover, minimum 720p; separate ≤ 3 min 0G-focused cut
- [ ] **Incremental commit history** — avoid large single commits that could trigger disqualification
- [ ] **Select ≤ 3 sponsors on submission form** — 0G (slot 1), Gensyn (slot 2), KeeperHub (slot 3)
- [ ] Team member names + contact info (Telegram & X) on submission form
- [ ] Public GitHub repo with README covering setup + architecture

---

## Integration Checkpoints (Go/No-Go Gates)

| Day                 | Gate                                                                                  | Status         |
| ------------------- | ------------------------------------------------------------------------------------- | -------------- |
| Day 0 (Apr 24)      | Contracts frozen                                                                      | ✅ done        |
| Day 2 (Apr 26)      | Stub loop visible — UI renders fixture events, mock workspace opens                   | ✅ done        |
| Day 4 (Apr 28)      | **POV-1 green** — Prompt → files → compile → deploy → preview click                   | ⬜ in progress |
| Day 5 (Apr 29)      | **Local heal green** — Revert → trace → patch → verify → remember, no mesh            | ⬜ not started |
| Day 6 (Apr 30)      | **Memory + 0G inference** — 0G Compute visible in UI; recall round-trip on 0G Storage | ⬜ not started |
| Day 7 (May 1)       | **Mesh additive** — AXL cross-process peer response verified before apply             | ⬜ not started |
| Day 8 (May 2)       | **Ship green** — KeeperHub simulation + execution + audit visible for Sepolia         | ⬜ not started |
| Day 8 (May 2)       | **Full arc green** — Build → break → heal → ship in one sitting                       | ⬜ not started |
| Day 8 (May 2)       | **Two-laptop rehearsal** — separate AXL processes on separate machines                | ⬜ not started |
| Day 9 (May 3, noon) | **Record and submit** — demo video (2–4 min) + 0G cut (≤ 3 min) + submission form     | ⬜ not started |

---

## Scope Cuts (in priority order if time slips)

1. Hosted public beta before judged demo — keep single-host trusted mode if needed
2. Remote auto-apply of peer patches — keep suggestions + local verification; require manual accept
3. Rich trace UI — preserve decoded revert reason and basic call tree
4. Post-deploy live interactions through KeeperHub — keep Ship itself load-bearing
5. Broad contract archetype coverage — nail one strong demo archetype
6. Fork UX polish — keep fork tool internal, skip UI polish
7. Dynamic model selection — one stable 0G path + explicit fallback is enough

---

## Post-Hackathon (out of scope now)

- [ ] Reputation and signing for mesh patches
- [ ] iNFT-backed Crucible agent identities on 0G
- [ ] Multi-chain local runtimes beyond EVM
- [ ] Pair-programming workspaces over AXL
- [ ] Plugin system for custom MCP servers
- [ ] Mainnet shipping with hardware-wallet approval flows
- [ ] Docker Compose top-level stack + operator playbook
- [ ] Gateway container for TLS + preview-subdomain routing
