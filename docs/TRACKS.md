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

**How this maps to the Track 2 brief:**

| Track 2 asks for...                                                                                                         | Crucible delivers...                                                                                                                                                   |
| :-------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Personal 'Digital Twin' agent that learns from user behavior and maintains evolving persistent memory via 0G Storage"      | Each Crucible agent learns from every revert it encounters and every fix it verifies. Memory persists across sessions on 0G Storage KV + Log.                          |
| "Specialist agent swarms that collaborate in real time via shared 0G Storage memory and coordinate inference on 0G Compute" | Crucible agents specialize in debugging. They share a 0G Storage knowledge layer and coordinate over AXL. Inference runs on 0G Compute.                                |
| "Clear explanation of how agents communicate and coordinate"                                                                | Agents communicate over AXL (structured help requests/responses). They coordinate via the shared 0G Storage knowledge layer (recall → remember with cross-node scope). |

**What we skip:** iNFT minting. It would feel bolted on and dilute the swarm narrative. The persistent-memory + emergent-collaboration angle is strong enough on its own.

**Submission strategy:** Reuse the Track 1 submission. Add a section explicitly explaining agent communication (AXL) and coordination (shared 0G Storage). The demo video already shows two agents collaborating — the Track 2 framing just emphasizes that angle.

---

## Gensyn — Best Application of Agent eXchange Layer (AXL)

**Fit:** High. The AXL integration is the centerpiece of the demo's "money shot."

**Why AXL is structural, not decorative:** Crucible doesn't use AXL for "agent chat" or "agent social network" — the two most common hackathon AXL projects. It uses AXL to solve a concrete, measurable problem: **reducing time-to-fix for unfamiliar smart contract reverts.** When the local agent hits a revert it has never seen, AXL is how it finds a peer that has. Remove AXL → the self-healing revert loop loses its mesh fallback and degrades to LLM-only reasoning from traces (unreliable).

**Depth of AXL integration:**

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

- [x] Uses AXL for inter-agent communication (no centralized message broker)
- [x] Demonstrates communication across separate AXL nodes (two laptops in the demo)
- [ ] Project built during the hackathon (fresh repo, incremental commits)

**Judge's likely questions & our answers:**

> _"How does the mesh handle malicious peers submitting bad patches?"_

`verify_peer_patch()` re-executes the candidate patch in a local Hardhat snapshot before the agent commits it. A bad patch reverts in the sandbox and is discarded. The agent only commits verified fixes. This is a stronger answer than "we trust peers" — lead with it.

> _"What happens if no peers respond?"_

The agent falls back to LLM reasoning from the trace. The mesh is an accelerator, not a dependency. Crucible works offline; the mesh makes it faster.

> _"Is this really cross-node, or just in-process?"_

The demo uses two separate laptops, each running its own Crucible backend + AXL node binary. We'll include a clip of `axl status` on both machines proving they are independent peers, not parent/child processes.

---

## KeeperHub — Best Use of KeeperHub + Builder Feedback Bounty

**Fit:** Very high. KeeperHub is the _only_ path from local to public chain.

**Why KeeperHub is structural, not decorative:** There is no `eth_sendRawTransaction` to a public RPC anywhere in the Crucible codebase. Every shipping flow — initial deploy, configuration calls, _and_ post-deploy preview interactions on the deployed testnet address — routes through KeeperHub. Remove KeeperHub → the _Ship_ button breaks. The product cannot reach a public chain.

**Depth of KeeperHub integration:**

| Flow            | What happens                                                                                                                                                                        |
| :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pre-flight**  | Agent calls `KeeperHub.simulate_bundle()` with the deployment + config txs. Inspector shows decoded simulation output + per-tx gas estimates.                                       |
| **Execution**   | Agent calls `KeeperHub.execute_tx()` for each tx. KeeperHub handles retry logic, gas optimization, and private routing. Inspector shows live status: `pending → mined → confirmed`. |
| **Audit**       | Every `execute_tx` returns an `auditTrailId`. Inspector displays it as a clickable link to the KeeperHub provenance record.                                                         |
| **Post-deploy** | User clicks _Deposit_ on the live preview (pointed at the deployed Sepolia address). That interaction also routes through KeeperHub — not a one-shot deploy button.                 |

**How this maps to the judging criteria:**

| Criterion                          | How we satisfy it                                                                                                                                                          |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does it work?**                  | The demo shows a full Ship flow: simulate → execute → audit trail. Then a post-deploy interaction also through KeeperHub.                                                  |
| **Would someone actually use it?** | Every Web3 developer needs to go from local to testnet. Today it's manual. Crucible makes it one click with full provenance.                                               |
| **Depth of KeeperHub integration** | KeeperHub is the _only_ public-chain path. Not a wrapper, not a checkbox — an architectural commitment.                                                                    |
| **Mergeable quality**              | Clean MCP client integration. `POST /api/ship` is a thin endpoint that calls KeeperHub MCP tools. The agent doesn't know about KeeperHub — it just calls `ship` as a tool. |

**Submission requirements checklist:**

- [x] Working demo (live or recorded) — the 4-min demo video covers the Ship flow
- [ ] Public GitHub repo with README covering setup + architecture
- [ ] Brief write-up explaining approach + how KeeperHub is used (this doc + ARCHITECTURE.md)
- [ ] Project name, team members, contact info

**Judge's likely questions & our answers:**

> _"Why KeeperHub instead of just `eth_sendRawTransaction`?"_

Because raw RPC calls give you none of: retry logic when gas spikes, gas optimization, private routing to avoid MEV extraction, or audit trails for provenance. KeeperHub is a production-grade execution layer. Crucible is a tool for building real dApps — the execution layer should match.

> _"Does the user need a KeeperHub account?"_

The free tier is sufficient for the demo (Sepolia testnet). For production use, the user brings their own API key. The `.env.example` file documents this.

---

### Builder Feedback Bounty ($500 — 2 × $250)

**Fit:** Very high. Free roll — same integration work, different deliverable.

**What we'll file:** Integrating KeeperHub MCP into a non-LangChain agent framework (OpenClaw) will surface real friction. We'll document:

- **UX/UI friction:** What was confusing about the MCP server setup when not using LangChain's built-in MCP client?
- **Documentation gaps:** Where did the KeeperHub docs assume LangChain/LangGraph and leave us stuck?
- **Missing endpoints:** What would have made the integration smoother for a non-Python, non-LangChain stack?
- **Feature requests:** What's missing that would have made the build easier?

**Key to qualifying:** Feedback must be specific and actionable. "Docs were confusing" won't qualify. "The MCP server setup guide assumes `langchain-mcp-adapters` — here's the exact 3-step workaround we needed for a raw `@modelcontextprotocol/sdk` client in TypeScript" will.

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

- Write-up must show **exactly where KeeperHub sits** — the _Ship_ path.
- Screenshots of the Inspector's **audit trail panel** with `auditTrailId` visible.
- Note that KeeperHub is the **only path** to public chains — no `eth_sendRawTransaction` anywhere.

### KeeperHub Feedback

- File `FEEDBACK.md` in the repo root.
- Must cover at least one of: UX/UI friction, reproducible bugs, documentation gaps, feature requests.
- Must be **specific and actionable** — generic praise or vague criticism will not qualify.
