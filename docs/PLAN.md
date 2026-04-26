# Plan — Decoupled Build Strategy, Proofs of Value & Decision Gates

> The hackathon runs **9 days** (April 24 – May 3, 2026, deadline **noon EDT**). This plan is intentionally not package-first. The earlier version coupled sponsor integrations, implementation packages, and demo beats into the same milestones, which made it too easy to finish a lot of code without proving the product thesis.

This version separates four things that must not be conflated:

1. Product proofs of value
2. Frozen interface contracts
3. Team ownership
4. Sponsor-specific integrations

The rule for the whole build: no milestone is considered done because a package exists. A milestone is done only when a user-visible proof works end-to-end behind a stable contract.

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

**Days 2-4 (April 26-28)**

**Goal:** Make one thin vertical slice work locally without any sponsor dependency beyond what is required for the agent to answer.

**Required outputs:**

- Real workspace directory creation and persistence
- PTY session reachable from the browser
- Preview dev server managed per workspace with a readable preview URL
- Real local chain lifecycle and local deploy path
- Agent can take a prompt, write files, compile, deploy, and narrate progress
- Frontend shows editor, preview, inspector shell, terminal, and event rail

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

**Days 7-8 (May 1-2)**

**Goal:** Keep public-chain execution isolated from the local development loop and make KeeperHub the only public-chain path.

**Required outputs:**

- `POST /api/ship` wired to KeeperHub only
- Simulation and execution status surfaced in the inspector
- Audit trail IDs visible and persisted
- Sepolia path working for at least one contract archetype

**Success demo:** User clicks Ship, sees KeeperHub simulation, execution status, and audit trail for the exact artifact that just ran locally.

**Kill criteria:** If shipping is unstable by Day 12, freeze scope to Sepolia, one contract archetype, and no live post-deploy interactions from the public preview.

### Phase 5 — Prove POV-5: Hosted Runtime and Demo Hardening

**CUT for hackathon — Post-Hackathon Only**

> With 9 days total, Phase 5 is explicitly out of scope. The judged demo runs in single-host trusted mode. The Docker Compose stack and runner isolation are post-hackathon work. See the kill criteria in Phase 4 — if shipping is stable, the demo is locked and the remaining time goes to demo hardening and the submission video, not runner extraction.

**Goal (post-hackathon):** Preserve the same mental model when moving from trusted demo mode to isolated runtime mode.

**Required outputs:**

- Control plane / workspace runner boundary extracted and exercised
- Docker Compose stack for gateway, control plane, runner, volume, and AXL sidecar
- Clear cold-start, reconnect, and crash-restart behavior
- Demo script with explicit fallback rules and operator playbook

**Success demo:** External tester opens a hosted workspace, waits through a cold start, and still sees the same preview, terminal, and agent model as in local demo mode.

**Kill criteria:** If runner isolation threatens demo stability, keep the judged demo on single-host trusted mode and ship the runner boundary as code-complete but not the required demo path.

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
