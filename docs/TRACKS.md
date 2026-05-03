# Tracks — Sponsor Alignment & Prize Strategy

> Crucible targets **three sponsors** (0G, Gensyn, KeeperHub) across **five tracks**. Each integration is load-bearing — remove it and the product loses a real capability. ENS is excluded: the 3-sponsor cap means we prioritize depth over breadth.

---

## Submission Strategy

ETHGlobal limits submissions to **3 sponsors max**, but within each sponsor you can apply to all their tracks. Crucible's strategy:

| Sponsor       | Tracks Applied                                  | Rationale                                                                                                                                                                      |
| :------------ | :---------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0G**        | Track 1 (Framework) + Track 2 (Agents/Swarms)   | Both tracks are addressable from the same codebase. Track 1 is primary; Track 2 is a free roll with different framing.                                                         |
| **Gensyn**    | Best Application of AXL                         | One track, one prize pool. The AXL integration is the centerpiece of the demo.                                                                                                 |
| **KeeperHub** | Best Use of KeeperHub + Builder Feedback Bounty | Main prize + feedback bounty. Both qualify from the same integration work.                                                                                                     |
| ~~ENS~~       | _Not applied_                                   | The 3-sponsor cap forces a choice. ENS would be a ~4-hour cosmetic add-on (agent names in text records). 0G/Gensyn/KeeperHub are structural — removing any breaks the product. |

---

## 0G — Primary Sponsor

**Why 0G is structural, not decorative:** The agent's **primary** inference path runs on 0G Compute. Its long-term memory lives on 0G Storage. Crucible itself ships as the reference agent built on a 0G-native OpenClaw extension. An OpenAI-compatible fallback exists only as a degraded-mode reliability path for public beta when 0G is unavailable or out of credits. Remove 0G → the primary judged flow loses verifiable inference, the 0G-native framework claim breaks, and the 0G track story collapses.

### Track 1: Best Agent Framework, Tooling & Core Extensions

**Fit:** High. This is Crucible's primary track.

**What we're submitting:**

Crucible ships as two artifacts in the same repo:

1. **A Web3-development extension to OpenClaw** (`packages/agent/`) — a reusable framework extension that gives any OpenClaw-based agent:
   - A **Web3 tool registry** that loads MCP servers by URL (chain, compiler, deployer, wallet, memory, mesh) and exposes them as typed tools to the agent loop.
   - **Solidity-aware code generation** prompt templates with compiler error feedback loops.
   - **Chain-state-aware planning** — the agent snapshots the local chain before risky operations and can roll back on failure.
   - **0G Compute inference adapter** — routes inference through 0G Compute by default, captures verifiable receipts, and can fail over to an OpenAI-compatible endpoint only in degraded public-beta mode.
   - **0G Storage memory adapter** — KV for hot recall index, Log for full debugging history, with cross-node sharing semantics.

2. **Crucible as the reference agent** — the example agent that ships with the extension, proving the framework works end-to-end.

**How this maps to the Track 1 brief:**

| Track 1 asks for...                                                                                                              | Crucible delivers...                                                                                                                                                                                                       |
| :------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "New OpenClaw modules that natively integrate 0G Compute's sealed inference"                                                     | The 0G Compute inference adapter routes the primary agent path through sealed models (`qwen3.6-plus`, `GLM-5-FP8`) and emits verifiable receipts. An OpenAI-compatible fallback exists only for degraded public-beta mode. |
| "Self-evolving agent framework that autonomously generates/tests/integrates new skills/tools using persistent 0G Storage memory" | The self-healing revert loop: agent detects failure → traces → recalls from 0G Storage → broadcasts for help → applies patch → verifies → writes back. The pattern library grows with every solved revert.                 |
| "Modular 'agent brain' library with easy swapping of memory layers (0G Storage KV/Log)"                                          | `memory-mcp` abstracts 0G Storage KV (recall index) and Log (full history) behind a clean MCP tool interface. Swap the storage backend by changing the MCP server — the agent doesn't care.                                |
| "At least one working example agent built using your framework/tooling"                                                          | Crucible itself is the example agent. The README shows how to prompt it, the demo video shows it building a real dApp.                                                                                                     |

**Submission requirements checklist:**

- [x] Project name + short description
- [ ] Contract deployment addresses (the dApps Crucible builds and ships to Sepolia during the demo)
- [ ] Public GitHub repo (README + setup instructions)
- [ ] Demo video < 3 min (we'll cut a separate 3-min cut for 0G from the 4-min main demo)
- [ ] Explain which protocol features/SDKs used (0G Compute, 0G Storage KV + Log)
- [ ] Team member names + contact info (Telegram & X)
- [ ] At least one working example agent (Crucible itself)
- [ ] Architecture diagram showing OpenClaw + 0G Storage/Compute integration

**Fallback policy for judging:**

- 0G remains the default provider in the product and the required provider for the planned demo path.
- The fallback provider exists to avoid dead demos or public-beta outages when 0G is unavailable or credits are exhausted.
- If fallback is used, the UI must show that clearly. Do not present fallback calls as 0G calls.

**Judge's likely questions & our answers:**

> _"What does the extension do that OpenClaw doesn't do out of the box?"_

The extension adds Web3-specific infrastructure: a tool registry that loads chain-aware MCP servers, Solidity code generation with compiler feedback loops, chain-state-aware planning with snapshot/rollback, and 0G-native inference + memory adapters. It's a _domain extension_ — the same way a database extension adds SQL-aware tooling to a general-purpose agent framework.

> _"Can someone else build a different agent with your extension?"_

Yes. The extension is a separate package. Crucible is the reference agent. Another team could build a security-auditing agent, a MEV-searching agent, or a multi-chain deployment orchestrator on the same extension. The tool registry is MCP-server-agnostic — add new MCP servers and the agent gains new capabilities.

---

### Track 2: Best Autonomous Agents, Swarms & iNFT Innovations

**Fit:** Medium. This is a secondary submission — same codebase, different framing.

**What we're submitting:**

The same Crucible codebase, framed as a **persistent, networked swarm of autonomous debugging agents**:

- Each Crucible instance is a long-running autonomous agent with persistent memory on 0G Storage (KV for real-time state + Log for full history). It survives across sessions — close the browser, reopen tomorrow, the agent remembers every pattern it learned.
- Crucible agents form an **emergent collaboration mesh** over AXL. They don't just coexist — they actively share knowledge (revert signatures → patches → verification receipts) through a shared 0G Storage knowledge layer coordinated over AXL.
- The swarm exhibits **emergent behavior**: an agent that has never seen a specific revert can fix it by pulling verified knowledge from a peer that solved it yesterday. No central coordinator. No human intervention.

### Track 2: Best Autonomous Agents, Swarms & iNFT Innovations

**Fit:** Medium → viable with correct framing. **Submission framing: Digital Twin, not swarm.**

**Prize structure:** Flat $1,500 per qualifying team, up to 5 teams. This is not a ranked pool — you qualify or you don't. The bar is demonstrating a persistent autonomous agent on 0G, not beating other teams.

**What we're submitting:**

Crucible as a **persistent autonomous developer agent** — a Digital Twin for smart contract development:

- Each Crucible instance is a long-running autonomous agent with persistent memory on 0G Storage KV (hot recall index for revert patterns) and 0G Log (full debugging history). It survives across sessions — close the browser, reopen tomorrow, the agent remembers every pattern it has learned.
- The agent uses 0G Compute for sealed inference with verifiable receipts on every turn.
- The agent deploys to 0G Chain directly via `deploy_og_chain`.

**Why this framing (not swarm):** The Digital Twin angle requires only what is already shipped: 0G Storage KV persistence + 0G Compute inference + 0G Chain deployment. The swarm angle adds AXL, which is now fully implemented (`mcp-mesh` is shipped), but framing the submission around Digital Twin is safer — it works without needing a two-laptop demo.

**Model guidance:** The repair loop has been validated end-to-end on **glm-5**, **minimax-b2.5**, and **deepseek-v4-pro** via the OpenAI-compatible fallback path; these are marked as recommended in the model picker. The 0G Compute testnet serves qwen2.5 7b — if it fails repair reasoning in demo conditions, switch to one of the validated models and ensure the fallback receipt badge is visible.

**How this maps to the Track 2 brief:**

| Track 2 asks for...                                                                                                    | Crucible delivers...                                                                                                                                                          |
| :--------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Personal 'Digital Twin' agent that learns from user behavior and maintains evolving persistent memory via 0G Storage" | Crucible learns from every revert it encounters. Patterns persist across sessions via 0G Storage KV. Each developer's Crucible instance accumulates a private knowledge base. |
| "Persistent context on 0G Storage + self-fact-checking using verifiable 0G Compute inference"                          | Every inference turn emits a verifiable `inference_receipt` with `x_0g_trace` from 0G Compute. The repair loop verifies patches in a local snapshot before committing.        |
| "Contract deployment addresses + demo video"                                                                           | `deploy_og_chain` deploys healed contracts to 0G Galileo testnet. Explorer URLs surface in the UI.                                                                            |

**What we skip:** Swarm framing, iNFT minting, AXL mesh — all require unbuilt infrastructure. The Digital Twin bullet alone qualifies.

**Submission strategy:** Reuse the Track 1 submission with a focused Track 2 framing section. Demo video shows: agent fixes a revert → recalls pattern from 0G KV → deploys to 0G Chain → close and reopen workspace → agent recalls the same pattern again (cross-session persistence proof).

---

## Gensyn — Best Application of Agent eXchange Layer (AXL)

**Fit:** High. **Status: `mcp-mesh` fully shipped.**

**Current state:** `packages/mcp-mesh` is fully implemented — `AXLNodeManager` handles ed25519 identity key generation, AXL binary lifecycle, background recv-poll loop, and in-memory response queuing. `server.ts` exposes all five MCP tools (`list_peers`, `broadcast_help`, `collect_responses`, `respond`, `verify_peer_patch`). In-container MCP server on port 3105; `tool-exec.ts` MESH_ROUTES proxy wired. Backend AXL key registry persists per-workspace AXL public keys. **Remaining:** same-machine dual-workspace AXL connectivity proof, two-laptop proof, POV-3 demo video.

**Why AXL is structural, not decorative:** Crucible doesn't use AXL for "agent chat" or "agent social network" — the two most common hackathon AXL projects. It uses AXL to solve a concrete, measurable problem: **reducing time-to-fix for unfamiliar smart contract reverts.** When the local agent hits a revert it has never seen, AXL is how it finds a peer that has. Remove AXL → the self-healing revert loop loses its mesh fallback and degrades to LLM-only reasoning from traces (unreliable).

**Depth of AXL integration (target):**

| Layer                    | What happens on AXL                                                                                                                                                             |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Peer discovery**       | Each Crucible backend runs an AXL node binary. On startup, it discovers peer Crucible nodes on the mesh. `mesh-mcp.list_peers()` surfaces live peers in the UI.                 |
| **Structured messaging** | `broadcast_help()` sends a structured request: `{revert_signature, full_trace, contract_source, solc_version, ttl}`. Not freeform chat — machine-parseable debugging artifacts. |
| **Response collection**  | `collect_responses()` gathers candidate patches + verification receipts from peers. The local agent verifies each patch in a sandboxed snapshot before applying.                |
| **Contribution**         | `respond()` lets a Crucible agent answer another's help request with a verified patch. The mesh is bidirectional — every agent both asks and answers.                           |
| **No central broker**    | All communication is end-to-end encrypted over AXL. No server, no cloud, no accounts. The demo proves this with two separate laptops.                                           |

**How this maps to the judging criteria:**

| Criterion                    | How we satisfy it                                                                                                                                                                |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depth of AXL integration** | AXL is not a wrapper. It carries structured debugging artifacts (traces, patches, receipts) with verification. The `mesh-mcp` server is a first-class MCP tool the agent wields. |
| **Quality of code**          | Monorepo with Turborepo, TypeScript 6.x, ESLint 9 flat config, Vitest 4.x. Clean separation: `mcp-mesh` is a standalone package that wraps the AXL node binary.                  |
| **Clear documentation**      | `ARCHITECTURE.md` has the full `mesh-mcp` tool spec. `PLAN.md` has the AXL integration checkpoints. `DEMO.md` will document the two-laptop AXL bootstrap config.                 |
| **Working examples**         | The demo video shows a real cross-node help request → response → verification cycle. Two laptops, two AXL nodes, one revert fixed.                                               |

**Submission requirements checklist:**

- [x] `mcp-mesh` package implemented (AXL node binary lifecycle, peer discovery, structured messaging)
- [x] Uses AXL for inter-agent communication (no centralized message broker)
- [ ] Demonstrates communication across separate AXL nodes (same-machine dual-workspace minimum)
- [x] Project built during the hackathon (fresh repo, incremental commits)

**Judge's likely questions & our answers:**

> _"How does the mesh handle malicious peers submitting bad patches?"_

`verify_peer_patch()` re-executes the candidate patch in a local Hardhat snapshot before the agent commits it. A bad patch reverts in the sandbox and is discarded. The agent only commits verified fixes.

> _"What happens if no peers respond?"_

The agent falls back to LLM reasoning from the trace. The mesh is an accelerator, not a dependency. Crucible works offline; the mesh makes it faster.

---

## KeeperHub — Best Use of KeeperHub + Builder Feedback Bounty

**Fit:** Very high for Focus Area 2 (framework integration). KeeperHub explicitly names OpenClaw as a target.

**Why KeeperHub is the right framing:** Focus Area 2 asks for "a plugin, connector, or SDK integration for ElizaOS, OpenClaw, LangChain, CrewAI, or any framework with an active builder community." Crucible integrating KeeperHub MCP into an OpenClaw-based agent is the described deliverable.

**Builder Feedback Bounty ($250 per winner, 2 winners):** Requires only a `FEEDBACK.md` in the repo root documenting real friction encountered during KeeperHub integration. Essentially free money if any KeeperHub integration ships. Write it during integration, not after.

**Depth of KeeperHub integration (shipped):**

| Flow                | What happens                                                                                                                                                                                                                    |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Discovery**       | Agent calls `keeperhub_list_action_schemas` to learn what action types are available and what fields each requires. Schemas are authoritative — no frozen client knowledge.                                                     |
| **Deploy**          | Agent deploys to Sepolia via `deployer.deploy_sepolia` (chainId 11155111, viem, Etherscan explorer URL). KeeperHub does not support contract creation as an action type — deployment is always through Crucible's own deployer. |
| **Wallet setup**    | Agent calls `keeperhub_get_wallet_integration` for chain `11155111` to retrieve the `walletId` needed for on-chain write actions.                                                                                               |
| **AI authoring**    | For natural-language keeper requests, agent calls `keeperhub_ai_generate_workflow` to draft a workflow, reviews it, then `keeperhub_create_workflow` to persist.                                                                |
| **Execution**       | `keeperhub_execute_workflow` fires the keeper; the returned `executionId` links to the KeeperHub audit trail. For one-off calls the direct-execution tools fire without storing a workflow.                                     |
| **Discovery-first** | Every interaction starts with schema/wallet discovery so the agent never hard-codes assumptions about the KeeperHub tool surface.                                                                                               |

**How this maps to the judging criteria:**

| Criterion                          | How we satisfy it                                                                                                                                                                                                                                                                        |
| :--------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does it work?**                  | The demo shows: deploy to Sepolia via `deploy_sepolia`, then `keeperhub_list_action_schemas` → `keeperhub_get_wallet_integration` → `keeperhub_ai_generate_workflow` → `keeperhub_create_workflow` → `keeperhub_execute_workflow`, Inspector shows each tool call and the `executionId`. |
| **Would someone actually use it?** | Every Web3 developer needs to go from local to testnet and wire on-chain automation. KeeperHub wraps retry logic, gas optimization, and audit trails. Crucible makes it conversational.                                                                                                  |
| **Depth of KeeperHub integration** | KeeperHub is the only automation path. Connected as a real hosted MCP with automatic schema discovery — not a wrapper, not a frozen client. Agent picks up new KeeperHub tools the moment they ship.                                                                                     |
| **Mergeable quality**              | Clean `createMCPClient({ transport: { type: 'http', headers: { Authorization: 'Bearer kh_…' } } })` integration in the agent loop. Tools are namespaced `keeperhub_*`. No Crucible code changes needed when KeeperHub adds tools.                                                        |

**Submission requirements checklist:**

- [x] Working demo (KeeperHub hosted MCP wired; agent connects to `https://app.keeperhub.com/mcp` with Bearer auth; `keeperhub_*` tools auto-discovered)
- [x] `FEEDBACK.md` in repo root with 5 specific items (qualifies for Builder Feedback Bounty)
- [ ] Public GitHub repo with README covering setup + architecture
- [ ] Brief write-up explaining approach + how KeeperHub is used (this doc + ARCHITECTURE.md)
- [ ] Project name, team members, contact info

**Judge's likely questions & our answers:**

> _"Why KeeperHub instead of just calling the chain directly?"_

Because raw `eth_sendRawTransaction` gives you none of: retry logic when gas spikes, gas optimization, private routing to avoid MEV extraction, or audit trails for provenance. KeeperHub is a production-grade automation and execution layer. The agent uses it for post-deploy keepers and on-chain interactions — not for contract deployment (which goes through Crucible's own `deploy_sepolia`).

> _"Does the user need a KeeperHub account?"_

The free tier is sufficient for the demo (Sepolia testnet). For production use, the user brings their own API key. The `.env.example` file documents this.

---

### Builder Feedback Bounty ($500 — 2 × $250)

**Fit:** Very high. Free roll — same integration work, different deliverable.

**What we filed:** `FEEDBACK.md` in repo root documents 5 specific items encountered during the hosted MCP integration:

1. **UX friction:** Bearer auth vs OAuth onboarding docs — the "Getting started → MCP" page leads with Claude Desktop / OAuth, not the server-side Bearer flow used by programmatic clients.
2. **Documentation gap:** `network` field expects a chainId string (e.g. `"11155111"`) but docs use names ("sepolia"); API rejects names with a generic error.
3. **Documentation gap:** `web3/write-contract` requires `walletId` but docs don’t say where to get it; answer is `keeperhub_get_wallet_integration`, but the cross-link is missing.
4. **Feature request:** No documented `web3/deploy-contract` action type — builders need to know explicitly that KeeperHub handles automation, not deployment.
5. **Feature request:** `keeperhub_list_action_schemas` returns input schemas but not output schemas — agents must probe-execute to discover output key names.

**Key to qualifying:** Feedback is specific and actionable with repro steps — qualifies for the feedback bounty.

---

## Why Not ENS?

The 3-sponsor cap forces a choice. Here's the tradeoff analysis:

| Keep 0G + Gensyn + KeeperHub                                               | Drop one for ENS                                                                                                    |
| :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| Three structural integrations. Remove any → product breaks.                | ENS would be a cosmetic layer: give Crucible agents `.eth` names, store metadata in text records. ~4 hours of work. |
| The demo narrative (build → break → heal → ship) hits all three naturally. | ENS would need its own demo segment — diluting the 4-minute arc.                                                    |
| Each sponsor gets a deep, defensible integration.                          | ENS would be "we added names to our agents" — hard to make load-bearing.                                            |

**Verdict:** 0G + Gensyn + KeeperHub is the correct trio. ENS is a good idea for a project whose primary identity layer _is_ ENS. Crucible's identity is "the agent that builds dApps" — not "the agent with a name."

---

## Prize Probability Matrix

| Track                      | Probability of Placing | Notes                                                                                                |
| :------------------------- | :--------------------- | :--------------------------------------------------------------------------------------------------- |
| 0G Track 1 (Framework)     | 70% (top-3)            | Primary track. Framework extension + reference agent is exactly the ask.                             |
| Gensyn AXL                 | 60% (top-3)            | Two-laptop demo is the differentiator. Most teams will demo in-process.                              |
| KeeperHub Main             | 65% (top-3)            | Deep integration (full workflow + audit trail UI). KeeperHub is the only path to public chains.      |
| KeeperHub Feedback         | 85%                    | Free roll. Specific, actionable feedback from a non-LangChain integration is exactly what they want. |
| 0G Track 2 (Agents/Swarms) | 30% (top-5)            | Secondary. Same codebase, different framing. Risk of looking like a repackaged T1 submission.        |

---

## Track-Specific Submission Notes

### 0G Track 1 (Framework)

- The OpenClaw extension must be a **separate package** in the repo (`packages/agent/`).
- Crucible is the **example agent** built on it — reference it in the README.
- Include **contract deployment addresses** — the dApps Crucible builds and ships to Sepolia during the demo.
- Architecture diagram must show **0G Storage and 0G Compute integration** with OpenClaw.
- Demo video < 3 min (cut a separate 3-min version from the 4-min main demo).

### 0G Track 2 (Agents/Swarms)

- Reuse the Track 1 submission with **different framing**.
- Emphasize: AXL-coordinated swarm, persistent 0G Storage memory, emergent knowledge sharing.
- Explicitly explain **how agents communicate** (over AXL) and **coordinate** (via shared 0G Storage knowledge layer).
- Skip iNFT angle entirely — don't mention it.

### Gensyn AXL

- Demo must show **two separate machines or VMs**, each running its own Crucible + AXL node.
- Include a short clip of `axl status` on both nodes proving they are peers.
- No centralized message broker — all comms over AXL.

### KeeperHub Main

- Write-up must show **exactly where KeeperHub sits** — the post-deploy automation layer (workflow CRUD, AI generation, direct execution).
- Screenshots of the Inspector showing `keeperhub_*` tool calls and the returned `executionId`.
- Note that KeeperHub is the **only automation path** for on-chain interactions after deployment — no `eth_sendRawTransaction` for write calls.
- Clarify: contract deployment goes through Crucible's `deploy_sepolia` (Sepolia) or `deploy_og_chain` (0G Galileo); KeeperHub handles everything after.

### KeeperHub Feedback

- File `FEEDBACK.md` in the repo root.
- Must cover at least one of: UX/UI friction, reproducible bugs, documentation gaps, feature requests.
- Must be **specific and actionable** — generic praise or vague criticism will not qualify.
