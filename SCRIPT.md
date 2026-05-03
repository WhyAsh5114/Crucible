# Crucible Demo Video — Complete Production Guide

## 1. What Crucible Is (30-second elevator pitch)

Crucible is a browser-based agentic development environment for Web3.

> "Describe a dApp. Watch it build itself. Ship it."

The agent writes Solidity contracts and a frontend, compiles them, spins up a local chain, deploys, renders a live preview, heals failed transactions, and ships to a real chain — all inside one browser tab. Every step is visible, inspectable, and overridable.

It is built as a Web3-development extension to OpenClaw, with:

- Sealed inference on 0G Compute (e.g. qwen3-6-plus / GLM-5-FP8)
- Persistent memory on 0G Storage (KV for hot state, Log for full history)
- Peer-to-peer fix sharing over the Gensyn AXL mesh
- A production shipping pipeline through KeeperHub

## 2. Demo Script

### Decision: What to Include vs. Skip

| Feature                               | Decision                       | Rationale                                                          |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Workspaces                            | ✅ Include (12s)               | Establishes the product mental model immediately                   |
| Wallet emulation MCP                  | ✅ Include (8s)                | Pre-funded labeled accounts is a clear differentiator vs. MetaMask |
| Hardhat node sim MCP                  | ✅ Background (terminal flash) | Visible in terminal during build; no dedicated time needed         |
| Code editor                           | ✅ Throughout                  | Always visible; no dedicated segment                               |
| 0G TEE inference                      | ✅ Include (8s)                | Click-to-expand receipt = 0G Track 1 proof                         |
| DevTools                              | ✅ 5-second flash              | Shows transparency. Quick cut during build.                        |
| Memory (0G KV + local)                | ✅ Include (20s)               | Core to repair loop and cross-session demo                         |
| Gensyn AXL + memory graph             | ✅ Include (35s)               | Centerpiece of two-device scene; most visually impressive segment  |
| Two-device memory demo                | ✅ Include                     | Essential for Gensyn track; must show two real machines            |
| KeeperHub MCP automation              | ✅ Include (50s)               | Required for KeeperHub track; `keeperhub_*` tool calls + executionId must be visible |
| 0G testnet deployment                 | ✅ Include (10s)               | `deploy_og_chain` → Galileo explorer URL; shown prominently in the 0G-specific cut; main demo deploys to Sepolia for KeeperHub |
| Mainnet / fork mode / multiple chains | ❌ Skip                        | Not worth the time at this stage                                   |
| Terminal in-depth                     | ❌ Background only             | Just flash during compile/deploy                                   |
| Autopilot toggle                      | ✅ 3-second show               | Click ⚡ auto before prompting; zero extra time                    |

### Timing Skeleton

| Segment                   | Time      | Duration |
| ------------------------- | --------- | -------- |
| Hook — The Problem        | 0:00–0:18 | 18s      |
| Workspace Open + Wallet   | 0:18–0:30 | 12s      |
| Build                     | 0:30–1:15 | 45s      |
| Break → Heal (money shot) | 1:15–2:28 | 73s      |
| Deploy + KeeperHub MCP automation        | 2:28–3:18 | 50s      |
| Architecture Close        | 3:18–4:00 | 42s      |

### Full Script

**[0:00 – 0:18] THE HOOK**

_Screen:_ Split view — five browser tabs open simultaneously: VS Code, MetaMask, a Hardhat terminal, Remix IDE, Etherscan. Everything looks messy and disconnected.

**VO:** "Web3 development in 2026 still looks like this. Five disconnected tools. An AI that can only see text files — zero awareness of your chain state, wallet balances, or deployment history."

_Hard cut to:_ Crucible workspace list — clean, dark UI, single browser tab.

**VO:** "Crucible puts everything in one place — and makes your AI agent the developer."

---

**[0:18 – 0:30] WORKSPACE + WALLET (12s)**

_Screen:_ Workspace list → click "+ New Workspace" → boot animation (status: starting → ready) → workspace opens.

Camera pans across the four panes: Editor (empty), Preview (placeholder), Terminal (bash prompt), Chat rail.

Embedded wallet panel slides open — labeled accounts visible: Alice (10 ETH), Bob (10 ETH), Carol (10 ETH).

**VO:** "Each workspace gets its own live Hardhat node, a real terminal, and ten pre-funded wallets. No MetaMask. No port forwarding. Sign in once with your wallet."

Show SIWE-authenticated badge briefly.

---

**[0:30 – 1:15] BUILD (45s)**

_Before typing:_ Camera shows Inspector — a prior turn's 0G receipt already expanded (pre-run the night before). Hover, show receipt for 3 seconds.

**VO:** "The primary inference path runs on 0G Compute — sealed model, verifiable receipt, attestation hash on every turn."

_User reaches for model picker — switches from 0G 7b to fallback (e.g. glm-5 via OpenAI-compatible path)._

**VO:** "For this build — a complex multi-function vault — we're switching to a more capable model. Crucible shows you exactly which provider is active. Always transparent."

_Fallback badge appears in chat rail. User clicks ⚡ auto (Autopilot toggle) — label reads: "Auto: the agent keeps going until done."_

User types in chat rail:

> "Build me a token vault with deposit, withdraw, and a 24-hour withdrawal cooldown."

_Screen activity — all happening live:_

- Agent streams tokens in chat rail
- Solidity contract appears line-by-line in CodeMirror editor (`DemoVault.sol` — `depositOf`, `withdraw`, `lastDeposit`, `COOLDOWN` visible)
- Terminal shows: `Hardhat node starting` → `mcp-compiler emitting Compiled 1 Solidity file` → `mcp-deployer logging DemoVault deployed to 0x742d...`

_Quick 4-second cut to DevTools sidecar panel:_ live stream of MCP tool calls — `chain.start_node`, `compiler.compile`, `deployer.deploy_local`. Label card: **"Every agent action is inspectable."**

_Back to main view:_

- Preview pane loads: DemoVault UI — Deposit/Withdraw buttons, balance display
- User clicks "Connect Wallet" in preview → in-tab approval popup (no MetaMask) → Alice connects

**VO:** "The agent writes contracts, compiles, deploys, and renders a live dApp. Every inference turn is sealed on 0G Compute — verifiable, not just a black box."

---

**[1:15 – 2:28] BREAK → HEAL (73s — THE MONEY SHOT)**

User clicks "Withdraw" in preview (no deposit made yet, 0-second cooldown elapsed).

Transaction fires → Inspector shows: `❌ Revert: CooldownNotElapsed()` with decoded EVM call stack.

**VO:** "Transaction reverts. Most tools stop here. Crucible doesn't."

Agent repair loop begins — each phase has a visible status card in Inspector:

1. 📸 `"Snapshotting chain state..."` (snapshot taken before any changes)
2. 🔍 `"Tracing transaction..."` (decoded trace: cooldown check fails at line 47)
3. 🧠 `"memory-mcp.recall() — checking 0G Storage..."` → card: **"No local hit. Asking the mesh."**
4. 📡 `"Broadcasting help request over AXL..."`

_Hard cut to Device 2 (second laptop — new shot, visibly different machine/background):_

- Terminal shows: `axl status: 2 peers connected`
- Memory graph visualization: knowledge nodes as circles (each = a Crucible instance), edges showing shared patterns — a live graph with labeled edges like `CooldownNotElapsed → patch_v1 (verified)`
- Device 2's chat rail: `"📨 Incoming help request from peer: CooldownNotElapsed"`
- After 2 seconds: Device 2 sends response card — patch + verification receipt shown

_Cut back to Device 1:_

- Inspector: `"✓ Peer patch received from node:a4f9... — verifying in snapshot..."`
- Snapshot re-execution: `"✅ Patch verified — withdraw succeeds in sandbox"`
- Agent applies patch, recompiles, redeploys
- User clicks Withdraw again → transaction mines → success toast

**VO:** "The mesh found the fix. Verified in a sandboxed snapshot before touching a single live byte."

_Brief cross-session memory demo (10 seconds):_

- `memory-mcp.remember()` card: `"Writing pattern to 0G Storage. Scope: mesh — now every peer benefits."`
- Close workspace tab → reopen same workspace
- Memory graph shows pattern still there: `"Recalled from 0G Storage — cross-session. The agent remembers."`

---

**[2:28 – 3:18] DEPLOY + AUTOMATE (50s)**

Back in the workspace. User: _"Deploy to Sepolia, then set up a keeper that calls `harvest()` every hour."_

Inspector panel — deploy then automate:

1. 📦 `deployer.deploy_sepolia` → `address: 0x8c3d… • txHash: 0x… • chainId: 11155111 • [View on Etherscan Sepolia]`
2. 🔍 `keeperhub_list_action_schemas` → inspector shows the action types KeeperHub exposes; agent picks `web3/write-contract` + `schedule/cron`
3. 💳 `keeperhub_get_wallet_integration({ chainId: "11155111" })` → returns `walletId: kw_…`
4. 🧠 `keeperhub_ai_generate_workflow({ description: "every hour, call DemoVault.harvest()" })` → returns a workflow draft (cron node → web3-write node), agent shows it inline
5. 📝 `keeperhub_create_workflow` → `workflowId: kwf_…`
6. ▶️ `keeperhub_execute_workflow` → `executionId: kex_…`
7. ✅ Inspector surfaces a clickable `View in KeeperHub: app.keeperhub.com/runs/kex_…` link

**VO:** "Crucible deploys. KeeperHub automates. The agent picks up KeeperHub's tools live over MCP — no client-side rebuild, no hand-rolled REST shim. Discovery, wallet integration, AI workflow generation, execution — all the model."

---

**[3:18 – 4:00] ARCHITECTURE CLOSE (42s)**

Full architecture diagram — clean, animated.

**VO (fast, confident):** "Seven custom MCP servers. The agent treats chain state, compilation, wallet, memory, mesh, and terminal as tools — not APIs you manually wire."

_Highlight 0G layer:_ "0G Compute for sealed inference with verifiable receipts. 0G Storage KV for hot recall, Log for full history — persistent across sessions, shared across nodes."

_Highlight Gensyn:_ "Gensyn AXL for the peer knowledge mesh. Real cross-node communication — not in-process theater. The memory graph shows how knowledge flows."

_Highlight KeeperHub:_ "KeeperHub is the agent's automation backplane. Once a contract is live, the agent talks to KeeperHub directly over MCP — workflow authoring, scheduled keepers, on-chain reads and writes. The model picks up new KeeperHub tools the moment they ship."

_Final card:_

> "Describe it. Watch it build. Ship it."

Logos: 0G • Gensyn • KeeperHub

GitHub URL + ethglobal.com/[submission]

### Separate 3-Minute 0G Cut (≤3:00 required for 0G Track submission)

Take the main video and:

- Cut the two-device / AXL / memory graph segment entirely (replace with: "No mesh hit — agent reasons from trace alone")
- In the repair loop, show `memory-mcp.recall()` hitting the local 0G KV cache (seeded from a prior session) → fix applied from memory
- Extend the 0G inference receipt moment: hold on the expanded receipt for 3 seconds, read off the `x_0g_trace` field
- Replace `deploy_sepolia` with `deploy_og_chain` to 0G Galileo — this is the proof-of-chain moment for the 0G track; hold on the Galileo chainscan URL for 3 seconds
- In the architecture close, cut the Gensyn section and expand the 0G Compute + Storage + Chain section

Resulting 3-min arc: **Build (0G inference) → Heal (0G Storage recall) → Ship (0G Chain) → 0G architecture slide**

### About DevTools: Yes, Include It

The 5-second flash during the Build phase is the right call. It answers the question judges will have watching the agent work — "what's actually happening under the hood?" — without pulling focus from the main arc. Frame it as the transparency story: **"Every MCP tool call, streamed in real time. Nothing is a magic black box."**

## 3. Model Handling

### Warm-up Turn Strategy (handling 0G 7b capacity limits)

The 0G testnet 7b model cannot handle the full vault build task. Use this two-step approach — which makes the switch a feature, not a failure:

**Turn 1 — 0G 7b (intentionally simple):** Pre-run a simple warm-up turn in the workspace the night before recording, e.g.:

> "What are the key security considerations for a token vault with a time-lock?"

The 7b model can answer that in plain text. That turn produces the 0G inference receipt. When the workspace opens during the demo, this receipt is already sitting in the Inspector. Click it, expand the `x_0g_trace` hash, hold for 3 seconds.

**VO:** "Every inference turn is sealed on 0G Compute. Here's the verifiable receipt from our last exchange — model, timestamp, attestation hash."

**Toggle to fallback — visibly:** Before typing the main prompt, switch the model picker:

**VO:** "0G Compute runs the primary sealed path. For heavy code generation tasks that push past testnet model capacity, Crucible falls over to an OpenAI-compatible provider — and tells you clearly when it does."

Type the vault prompt → fallback model executes → fallback badge is visible the whole time (different color/icon than the 0G receipt badge).

> **Why this works for judges:** The 0G receipt still counts for Track 1 because the spec requires "primary inference path runs on 0G Compute" — the warm-up turn proves the path is real and wired. What kills you is pretending the 7b model did the work. What helps you is demonstrating that the architecture handles degraded mode gracefully and transparently.

### Primary path — 0G Compute (sealed inference)

| Field    | Value                                    |
| -------- | ---------------------------------------- |
| Models   | qwen3-6-plus, GLM-5-FP8 (configurable)   |
| Endpoint | 0G Compute OpenAI-compatible API         |
| Auth     | Wallet-signed bearer token               |
| Context  | Full project state injected per request  |
| Memory   | 0G Storage KV (hot) + Log (full history) |

### Fallback path — Public beta / degraded mode

| Field        | Value                                                     |
| ------------ | --------------------------------------------------------- |
| Models       | Standard OpenAI / Anthropic models                        |
| Trigger      | 0G Compute node unreachable or budget exceeded            |
| Behaviour    | Identical agent behaviour, no sealed inference guarantees |
| UI indicator | Banner shown: "Running in public fallback mode"           |

### Context assembly per agent turn

```
system prompt
└── agent role + tool registry
user message
└── prompt
tool context
├── current workspace file tree
├── .crucible/state.json (deployments, addresses)
├── terminal output (last N lines)
├── 0G Storage KV: recent memory entries
└── AXL peer response (if triggered)
```

## 4. Expected Timelines

### Recording — Raw Footage

| Scenario                                     | Estimated Time |
| -------------------------------------------- | -------------- |
| Single clean take (app seeded, dry run done) | 15–20 min      |
| 2–3 takes with minor mistakes                | 30–45 min      |
| Multiple retakes + setup issues              | 60–90 min      |

**Tips:**

- Have the app running and seeded with test data before hitting record
- Do one untimed dry-run walkthrough first
- Record in segments (one clip per scene) — easier to redo just the bad part

### Voiceover

| Scenario                                      | Estimated Time |
| --------------------------------------------- | -------------- |
| Script ready, one clean read                  | 15–20 min      |
| A few stumbles, 2–3 retakes per section       | 30–45 min      |
| Writing the script + recording simultaneously | 60–90 min      |

**Tips:**

- Write bullet points, not word-for-word — sounds more natural on camera
- Record VO after you have a rough cut so your timing matches what's on screen
- Cap.cut / DaVinci let you record VO directly on the timeline

### Editing + Export

| Task                               | Estimated Time |
| ---------------------------------- | -------------- |
| Assembly cut (sync clips to VO)    | 30–60 min      |
| Trimming dead air, fixing pacing   | 30–45 min      |
| Text overlays, callout annotations | 20–30 min      |
| Colour grade / audio levels        | 15–20 min      |
| Export + upload                    | 10–15 min      |
| **Total editing**                  | **~2–4 hours** |

**Cap-specific notes:**

- Cap is good and fast for screen recordings but its text overlay tooling is more limited than DaVinci/Resolve — if you need precise callout arrows or animated highlights, budget extra time or just use zoom + cursor emphasis instead
- Export quality: make sure you're exporting at 1080p60 minimum, Cap defaults are fine but double-check before the final render
- Cap's timeline scrubbing can lag on long clips — if your raw recording is >10 minutes, trim it into segments first
- Cap can record VO directly in the timeline which helps sync timing

### Full Production Budget

| Phase                 | Conservative     | Optimistic   |
| --------------------- | ---------------- | ------------ |
| Raw footage recording | 45–60 min        | 20 min       |
| Voiceover             | 30–45 min        | 15 min       |
| Editing + export      | 2–4 hours        | 1.5 hours    |
| **Grand total**       | **~3.5–6 hours** | **~2 hours** |

Plan for a full day if you want a polished result without stress. With the app stable, a script ready, and one dry run done, a focused 3–4 hour session is realistic.

## 5. Pre-Recording Checklist

- [ ] App running locally with no errors
- [ ] Workspace pre-created (but don't start the demo in it — show the workspace list → new workspace flow)
- [ ] Workspace pre-seeded: DemoVault deliberately written **with** the off-by-one cooldown bug — do not fix it before recording
- [ ] One simple 0G warm-up turn pre-run in the workspace (receipt already in Inspector before hitting record)
- [ ] Device 2 (second laptop/screen): Crucible running, AXL peer already connected, `CooldownNotElapsed` memory pattern pre-seeded
- [ ] Memory graph UI open on Device 2 before the cut
- [ ] AXL peer mock or live node ready to respond
- [ ] KeeperHub API key with Sepolia testnet credits ready
- [ ] 0G Compute credits confirmed; fallback provider also configured (show it clearly if it fires)
- [ ] 0G Galileo testnet credentials loaded
- [ ] Browser zoom set to comfortable recording level (e.g. 90%)
- [ ] Notifications and Slack muted
- [ ] Terminal font size readable on screen
- [ ] Recording software tested with a 30-second sample clip
- [ ] Script / bullet points printed or open in a second monitor
- [ ] Dry-run walkthrough completed (untimed)

### Critical Moments to Rehearse (most likely to fail)

- **AXL peer connection between two laptops** — test on same network, then different networks
- **KeeperHub workflow execution completing in < 60 seconds on 0G Galileo** — do a dry run the day before
- **The 0G inference receipt appearing on the warm-up turn** (not on a fallback call) — confirm the night before
- **The cross-session memory recall** — close + reopen workspace = ~30-second cold start, budget that time

## 6. Key Talking Points to Hit

- One-tab workflow — no MetaMask popup wrangling, no five apps open
- Full transparency — every agent action is visible; developer can override at any point
- 0G is load-bearing, not decorative — sealed inference + persistent memory are structural
- AXL is real peer communication — not in-process actor theater; cross-node help requests
- KeeperHub is the only path to mainnet — simulation + gas + retries + audit trail baked in
- The preview is a real dev server — not a blob URL; HMR, wallet injection, real origin
