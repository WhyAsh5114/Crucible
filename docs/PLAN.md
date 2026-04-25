# Plan — 14-Day Build Strategy, Team Division & Integration Checkpoints

> The hackathon runs **14 days**. This document is the operational plan: how the work is divided, what gets built when, and how we know we're on track.

---

## Priority Order

The order below reflects dependencies and risk. Week 1 builds the substrate the rest depends on. Week 2 builds the differentiating features.

1. **OpenClaw + 0G substrate** — The agent's inference and memory. If this slips, the 0G Track 1 submission is at risk.
2. **Workspace runtime substrate** — Real filesystem-backed workspaces, per-workspace preview servers, and PTY terminal sessions. If this is vague, the product feels magical instead of trustworthy.
3. **KeeperHub Ship path** — The architectural commitment that makes KeeperHub a hard dependency. Ship must work before the demo can show shipping.
4. **Self-Healing Revert with mesh + memory** — The "WOW factor" and the centerpiece of the demo. This is what makes Crucible memorable.
5. **Workspace polish** — Editor, preview, inspector, terminal, and mesh surfaces. These must work cleanly for the demo to be watchable.
6. **Two-laptop AXL demo rehearsal** — The Gensyn track depends entirely on this working live.
7. **Dockerized live deployment** — A control plane plus workspace-runner split so external testers can use the product without running arbitrary code in the main app container.

---

## Team Division

Three developers. Each owns a vertical slice of the stack. All share `packages/types`.

| Package | Owner | Vertical slice |
| :--- | :--- | :--- |
| `packages/types` | **All three** | Shared TS contracts — frozen Day 0 |
| `packages/backend` | **Dev A** | Hono server, WS proxies, startup sequencer |
| `packages/mcp-chain` | **Dev A** | Hardhat node lifecycle |
| `packages/mcp-compiler` | **Dev A** | solc-js compilation |
| `packages/mcp-deployer` | **Dev A** | Local deploy + trace |
| `packages/mcp-wallet` | **Dev A** | Account management |
| `packages/mcp-terminal` | **Dev A** | PTY-backed terminal sessions |
| `packages/agent` | **Dev B** | OpenClaw extension + agent loop |
| `packages/mcp-memory` | **Dev B** | 0G Storage KV + Log |
| `packages/mcp-mesh` | **Dev C** | AXL node wrapper |
| `packages/frontend` | **Dev C** | SvelteKit workspace UI + wterm terminal surface |

**Rule:** No package imports from another package's `src/`. Only via the built `types` contract. Agent ↔ MCP communication is HTTP only — no direct function calls across package boundaries.

---

## Week 1 — Substrate and Local Loop

### Dev A — Chain Substrate

**Goal:** A working local development loop with a real workspace root, real preview process, and real PTY shell. Agent prompt → compile → deploy → preview loads from its own origin.

**Days 1–7:**
- [ ] Bootstrap monorepo (`package.json` with `workspaces`, `turbo.json`, root `tsconfig.json`, `eslint.config.ts`, `.prettierrc`, Vitest config)
- [ ] `packages/backend` — Hono server scaffold (Bun adapter): `GET /api/workspace/:id`, `POST /api/prompt` (stubbed), WebSocket upgrade via `hono/ws`, startup sequencer that boots all MCP servers, a dedicated Hardhat child process per workspace, the PTY session, and the preview process supervisor on workspace open
- [ ] Workspace filesystem manager — create `/workspace/{workspaceId}/contracts`, `/frontend`, and `.crucible/` on workspace creation; persist `.crucible/state.json`
- [ ] `packages/mcp-chain` — `start_node`, `get_state`, `snapshot`, `revert`, `mine` (Hardhat JSON-RPC + `hardhat_*` methods via viem)
- [ ] `packages/mcp-compiler` — `compile`, `get_abi`, `get_bytecode`, `list_contracts` (solc-js, caches artifacts to disk)
- [ ] `packages/mcp-deployer` — `deploy_local`, `simulate_local`, `call` (viem `deployContract`, `simulateContract`)
- [ ] `packages/mcp-wallet` — `list_accounts`, `get_balance`, `sign_tx`, `send_tx_local`, `switch_account` (pre-funded Hardhat accounts via viem `privateKeyToAccount`)
- [ ] `packages/mcp-terminal` — `create_session`, `write`, `exec`, `resize` backed by `node-pty`
- [ ] Preview dev server supervisor — boot a per-workspace frontend dev server rooted at `/workspace/{workspaceId}/frontend/` and expose it to the UI
- [ ] Preview HTML bootstrap injector — prepend a same-origin `/__crucible/preview-bridge.js` script into the preview HTML before app code executes
- [ ] Cross-origin wallet bridge — preview iframe uses exact-origin `postMessage` to the parent shell; the parent shell owns `/ws/rpc`
- [ ] WebSocket RPC proxy at `/ws/rpc` — accepts shell-owned Ethereum JSON-RPC frames and forwards approved methods to local Hardhat
- [ ] WebSocket terminal proxy at `/ws/terminal` — pipes browser terminal I/O to the PTY session
- [ ] Portless integration — main app at `https://crucible.localhost`, previews at `https://preview.{workspaceId}.crucible.localhost`
- [ ] Preview security pass — iframe sandbox policy, host-only control-plane cookies, `frame-src` / `frame-ancestors` / `connect-src` headers, WS origin checks, RPC method allowlist, and per-workspace rate limits
- [ ] Dockerize the control plane — Bun app, mounted data volume, and gateway integration points
- [ ] Extract the workspace runtime boundary — Hardhat + preview + PTY should be able to run as a workspace runner container, not only as host child processes

**Deliverable:** All 7 custom backend MCP servers respond on predictable ports (`3100–3106` excluding external KeeperHub), accept Zod-validated tool schemas from `packages/types`, and return typed responses. `GET /api/workspace/:id` returns `WorkspaceState`, including `previewUrl` and `terminalSessionId`. The preview loads from its own origin with a same-origin EIP-1193 bootstrap, the shell validates cross-origin preview messages, the RPC proxy at `/ws/rpc` accepts standard EIP-1193 JSON-RPC frames from the shell only, and the terminal proxy at `/ws/terminal` streams PTY data.

### Dev B — Agent & Integrations

**Goal:** A working agent that can respond to prompts and emit typed events.

**Days 1–7:**
- [ ] `packages/agent` — OpenClaw Web3-dev extension scaffold: tool registry (loads MCP servers by URL), agent planning loop, code generation prompt templates for Solidity + frontend
- [ ] 0G Compute inference integration: `POST` to 0G Compute endpoint, capture verifiable inference receipt, emit `inference_receipt` agent event
- [ ] OpenAI-compatible inference fallback — OpenRouter or similar, routed behind an inference provider adapter with explicit degraded-mode signaling
- [ ] Agent event stream: SSE emitter over the `/ws/agent?streamId=<id>` channel, emitting all `AgentEvent` union variants
- [ ] `packages/mcp-memory` — `recall`, `remember` backed by 0G Storage KV (recall index) + Log (full history); Zod schemas match `MemoryPattern` and `MemoryRecallHit`
- [ ] Wire agent to all five Dev A MCP servers via HTTP (use mock/stub servers during Dev A's Week 1)
- [ ] Separate control-plane tool routing from workspace-runtime tool execution so compile/deploy/terminal calls work whether the runtime is local child processes or a runner container

**Deliverable:** `POST /api/prompt` accepts `PromptRequest`, starts emitting `AgentEvent` frames on the WS channel referenced by `streamId`. `mcp-memory` responds on port `3104`.

### Dev C — Frontend & Mesh

**Goal:** A visible workspace UI that renders agent events, shows the live preview, and exposes the terminal so the runtime is inspectable.

**Days 1–7:**
- [ ] `packages/frontend` — SvelteKit 2 workspace shell: 4-pane layout (editor top-left, preview top-right, inspector bottom-left, terminal/mesh tabbed panel bottom-right), responsive splitter
- [ ] CodeMirror 6 editor with `@codemirror/lang-solidity`, theme, basic keybindings
- [ ] Agent chat rail: renders `AgentEvent` stream from the WS (use a mock WS emitter that replays a fixture JSON file during Dev B's Week 1)
- [ ] Live preview `<iframe>` — `src` is the backend-managed preview URL, sandboxed, and paired with a parent-side bridge that validates preview-origin messages before forwarding EIP-1193 requests to `/ws/rpc`
- [ ] Transaction Inspector skeleton: columns for timestamp, fn name, gas, status; expandable row for trace, events
- [ ] Terminal pane with `@wterm/react`, connected to `/ws/terminal?sessionId=<id>`
- [ ] `packages/mcp-mesh` — AXL node binary auto-installer (`axl-node` binary downloaded on first `start`), `list_peers` tool working against the public Crucible AXL mesh
- [ ] Hosted domain support — frontend handles real public domains the same way it handles Portless hosts locally

**Deliverable:** Frontend connects to `wss://crucible.localhost/ws/agent?streamId=<id>`, `wss://crucible.localhost/ws/rpc`, and `wss://crucible.localhost/ws/terminal?sessionId=<id>`. The shell owns the RPC connection, the preview talks through the validated bridge, all WS message parsing is typed against `packages/types`, and `mcp-mesh` responds on port `3105`.

---

## Week 2 — Mesh, Ship, Heal

### Dev A — Chain Substrate (continued)

**Days 8–14:**
- [ ] `deployer-mcp` — `trace` tool using `debug_traceTransaction` + viem ABI decoding (decoded calls, storage diff, events, revert reason)
- [ ] `chain-mcp` — `fork` tool (Hardhat `hardhat_reset` with `forking` config)
- [ ] `backend` — `POST /api/chain/fork`, `POST /api/ship` stub (KeeperHub path, wires into Dev B's agent)
- [ ] Preview process reliability pass — restart on crash, preserve readable preview URL, and keep `.crucible/state.json` synchronized
- [ ] Snapshot/revert stability pass, error boundary handling
- [ ] Integration: verify agent can compile → deploy → trace end-to-end via MCP over HTTP
- [ ] Docker Compose stack — gateway + control plane + persistent volume + AXL sidecar
- [ ] Home-hosted ingress — Cloudflare Tunnel or equivalent for the laptop deployment

### Dev B — Agent & Integrations (continued)

**Days 8–14:**
- [ ] Self-healing revert loop: detect revert from `tool_result` → `trace` → `recall` → `broadcast_help` (via Dev C's `mesh-mcp`) → apply patch → `deploy_local` to snapshot → verify → `remember`
- [ ] Terminal narration — agent writes meaningful progress output to the shared terminal instead of silently mutating state
- [ ] KeeperHub MCP client integration: `simulate_bundle`, `execute_tx`, `get_execution_status` — wired into the agent's *Ship* action; emit `KeeperHubExecution` events to the stream
- [ ] `POST /api/ship` implementation in `backend` (calls KeeperHub for every public-chain tx, zero bypass)
- [ ] Pre-seed 0G Storage with ~20 known revert patterns (`STF`, `TRANSFER_FAILED`, overflow, reentrancy guard, allowance, cooldown) so demo mesh hits feel reliable
- [ ] `mcp-memory` — `list_patterns`, `provenance` tools
- [ ] Runner-aware orchestration — agent targets the correct workspace runtime when invoking compile, deploy, trace, and terminal tools
- [ ] Inference budget controls — fallback triggers, admin kill switch, and `DEMO_MODE_0G_ONLY` support

**Deliverable:** `POST /api/ship` returns `ShipResponse` with `KeeperHubExecution[]`. Every public-chain transaction routes through KeeperHub.

### Dev C — Frontend & Mesh (continued)

**Days 8–14:**
- [ ] `mcp-mesh` — `broadcast_help`, `collect_responses`, `respond`, `verify_peer_patch` tools (structured JSON messages over AXL, no central broker); responds on port `3105`
- [ ] Mesh panel: live peer list (`MeshPeer[]`), in-flight help requests, incoming responses with patch previews
- [ ] Inspector: full `TxTrace` rendering — decoded call tree, storage diff table, event log, revert reason highlighted
- [ ] Inspector: KeeperHub panel — `status`, `retries`, `auditTrailId` (link to KeeperHub provenance URL)
- [ ] Inspector: inference receipt badge (0G Compute receipt per agent response)
- [ ] Inspector/provider badge — show active inference provider and degraded-mode status when fallback is active
- [ ] Embedded dev wallet UI: account switcher overlay triggered by `sign_tx` requests; labeled accounts (Alice, Bob…), balance display
- [ ] Mesh panel as a secondary tab, not the default bottom-right surface; terminal is the default so the runtime feels inspectable rather than magical
- [ ] Two-laptop demo config: environment variable for AXL bootstrap peer, documented in `DEMO.md`
- [ ] Hosted runtime UX polish — loading states, reconnect states, and clear cold-start messaging when a workspace runner is starting remotely

**Deliverable:** `mcp-mesh` server responds on port `3105` and accepts the mesh tool schemas from `packages/types`.

---

## Integration Checkpoints

| Day | Gate | What must work | Who verifies |
| :--- | :--- | :--- | :--- |
| **0** | Contracts frozen | `packages/types` PR merged, all three devs approve | All |
| **3** | Stubs live | Dev A's MCP servers return typed fixtures; Dev B's mock WS emits fixture events; Dev C's UI renders them | Each dev self-tests |
| **4** | Runtime green | Workspace directory exists, terminal session attaches, preview URL resolves, and Portless routing is stable | Dev A + C verify |
| **5** | Local loop green | Agent prompt → compile → deploy → preview loads from workspace dev server → user click mints token | Dev B drives, Dev A + C verify |
| **8** | Memory working | Revert → trace → `recall` → `remember` round-trip on 0G Storage | Dev B drives |
| **10** | Mesh green | Two terminals on same machine, separate Crucible workspaces on AXL, revert broadcast, peer responds | Dev C drives |
| **11** | Ship green | Click *Ship to Sepolia* → KeeperHub executes → audit trail in Inspector | Dev B drives |
| **12** | End-to-end green | Full demo arc in one sitting, no skips | All three together |
| **13** | Two-laptop rehearsal | Two physical machines, real AXL peer separation | Dev C leads |
| **13** | Public beta green | Dockerized stack runs on the laptop, workspace runners cold-start successfully, and one external tester can use the app end-to-end | All |
| **14** | Record demo | 4-minute video, submit | All |

---

## Stub Strategy (Days 1–4)

Before integration points are live, each dev works against typed stubs so no one is blocked:

- **Dev C building UI against agent events:** `packages/frontend/src/lib/fixtures/agentEvents.json` — a JSON array of `AgentEvent` objects covering every variant. A dev-only mock WS server replays it on `bun run dev`.
- **Dev B building agent against chain MCPs:** Each Dev A MCP server has a `--mock` flag that returns valid typed fixtures without starting Hardhat. Dev B sets `MOCK_CHAIN_MCPS=true` in `.env.dev`.
- **Dev A building backend without agent:** `POST /api/prompt` stubs a response immediately and emits three fixture `AgentEvent` frames on the WS, enough to verify the transport layer.
- **Dev A + C building terminal/preview surfaces:** the backend exposes a fake preview URL and a PTY fixture stream so the UI can be wired before Hardhat and the real preview server are stable.

All stubs are in `src/fixtures/` within each package and are never imported in production paths (gated by `process.env.NODE_ENV !== 'production'`).

---

## Explicit Non-Goals

These are explicitly out of scope for the hackathon:

- **Uniswap API integration** — The track requires an agentic-finance product. Crucible is a dev tool. A user-built swap dApp inside Crucible doesn't constitute a Uniswap API integration by Crucible.
- **iNFT minting** — Skip even for 0G Track 2. The persistent-memory + emergent-collaboration angle is strong enough on its own.
- **Mainnet deployments in the demo** — Sepolia is enough. Mainnet adds risk for no extra prize signal.
- **In-process "Fleet Mode"** — Replaced entirely by real cross-node AXL peers. Judges will see through in-process actor theater.
- **Browser-hosted runtime via WebContainers** — Not a fit for Hardhat tracing, AXL binaries, and shared long-lived PTY sessions.

---

## Post-Hackathon

These are future directions, not hackathon deliverables:

- Reputation and signing for mesh patches (so peer hints can be trusted at scale)
- iNFT-minted Crucible agent identities on 0G
- Multi-chain support (Solana, Sui local validators)
- Pair-programming workspaces (live shared session over AXL)
- Plugin system for custom MCP servers
- Mainnet shipping flow with hardware-wallet support via KeeperHub