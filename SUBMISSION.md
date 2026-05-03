ETHGlobal Submission — Prize Answers

0G — $15,000

How are we using 0G?

Crucible uses 0G Storage KV as the memory layer for the AI repair agent: when the agent fixes a contract revert, it stores the revert signature → working patch mapping under typed stream IDs (local and mesh scopes) via the Batcher API. On the next run with the same revert, it reads back the pattern using a KV iterator instead of burning tokens re-solving it.

We also run inference through 0G's testnet, falling back to OpenAI for code-heavy tasks since 7B models aren't strong enough for contract repair yet.

Why we're applicable:
The 0G KV SDK is at the core of mcp-memory, our persistent agent state service. It's not just a demo integration. Patterns are written, read, and purged in production flows, and inference is part of the repair loop.

Line of code:
https://github.com/WhyAsh5114/Crucible/blob/main/packages/mcp-memory/src/service.ts#L281

Ease: 7/10

Feedback:

- KV node docs are sparse. Iterator semantics, what seekToFirst throws on an empty stream, how stream IDs are formatted, when the indexer lags — all required reading the SDK source. That stuff should be in the docs.
- No local dev story. You need an always-on node to serve your streams. A Docker Compose snippet in the quickstart would cut setup time significantly.
- The turbo-testnet indexer URL took Discord digging to find. Should be front-and-center.
- 7B inference models aren't usable for code generation tasks. Fine for classification, but if 0G wants builders to use inference for coding agents, stronger models on testnet are a must.

Gensyn — $5,000

How are we using Gensyn?

Crucible embeds a Gensyn AXL node inside each workspace Docker container to form a P2P mesh of AI agent instances. When the repair loop hits an unfamiliar revert and memory returns nothing, the agent broadcasts the problem — revert signature, trace, and contract source — to peers over AXL. It collects patch suggestions from peers, verifies each one by re-deploying on a local chain snapshot, and stores the first passing patch back to memory. Peers that receive a broadcast can also respond with patches they've previously verified.

Why we're applicable:
The AXL node lifecycle (key generation, config, peer discovery, message send/recv) is fully integrated into the runtime container and wired up as an MCP tool server. The mesh collaboration workflow is a first-class fallback in the agent's repair loop, not a side experiment.

Line of code:
https://github.com/WhyAsh5114/Crucible/blob/main/packages/mcp-mesh/src/node-manager.ts#L283

Ease: 5/10

Feedback:

- No stable API contract. The /topology response shape has changed at least twice across AXL versions: peer arrays appear under 'peers', 'known_peers', 'connected_peers', and 'routing_table' depending on the build. We had to write a defensive normalisation loop that tries every known field name. A versioned schema or changelog would have saved several hours.
- The /recv endpoint returns 204 No Content when the queue is empty, but its Content-Type stays 'text/plain' on 200 — there is no envelope or framing, so you can't distinguish message types without your own application-layer envelope. We wrap every message in a JSON envelope ({type, data}) to handle this, but that should be a note in the docs.
- No local dev story without running the AXL binary. The binary isn't published to npm or a package registry — it's a Go binary that must be built from source or baked into a Docker image. A pre-built release binary on GitHub Releases with SHA checksums would cut setup significantly for hackathon builders.
- Bootstrap peer discovery is eventually consistent and the lag is invisible. After a fresh node starts, /topology may return an empty tree for 10-30 seconds while gossip propagates. There's no readiness signal beyond polling — we poll isReady() with a 30-second timeout but there's no indication of whether the node is still bootstrapping vs. genuinely isolated.
- No message delivery guarantees or receipts. /send returns 200 if the local node accepted the payload, but you have no way to know if the peer ever received it. For a patch-exchange workflow where correctness matters, even a best-effort ACK or a message ID in the /recv response would help distinguish 'peer didn't respond' from 'message was lost'.

KeeperHub — $5,000

How are we using KeeperHub?

Crucible's agent connects to KeeperHub's hosted MCP server (`https://app.keeperhub.com/mcp`) on every turn when `KEEPERHUB_API_KEY` is set on the backend. KeeperHub's full tool surface — workflow CRUD, AI workflow generation, action-schema discovery, wallet integrations, direct execution — is exposed to the model as namespaced `keeperhub_*` tools via `@ai-sdk/mcp` with `schemas: 'automatic'`, alongside Crucible's own MCP servers (chain, compiler, deployer, wallet, memory, mesh, terminal). Once a contract is deployed (locally on Hardhat or to Sepolia via `deploy_sepolia`), the agent uses `keeperhub_ai_generate_workflow` / `keeperhub_create_workflow` / `keeperhub_execute_workflow` to wire keepers, scheduled actions, and on-chain reads/writes against that contract — fully driven by the model with no custom UI scaffolding. KeeperHub becomes the agent's automation backplane the moment the user moves past the local dev loop.

Why we're applicable:
The integration is the most natural one possible: agent + hosted MCP, with the platform's own discovery surface (action schemas, wallet integrations) as the source of truth. There is no hand-rolled REST shim, no parallel data model, no abstraction the model has to learn around. KeeperHub ships a tool, the agent picks it up next turn. We pair this with grounded `FEEDBACK.md` from actually building it.

Line of code:
https://github.com/WhyAsh5114/Crucible/blob/main/packages/agent/src/loop.ts (KeeperHub MCP client setup in the per-turn agent loop)

Ease: 8/10

Feedback (full version in `FEEDBACK.md`):

- The hosted MCP accepts `Authorization: Bearer kh_…` for server-to-server clients, but the onboarding docs lead with the OAuth / Claude Desktop flow, which made this non-obvious.
- The `network` field on action schemas wants a chainId **string** (`"11155111"`); example values use names (`"sepolia"`), which the API rejects.
- `web3/write-contract` requires a `walletId` whose discovery path (`get_wallet_integration`) isn't cross-linked from the write-action docs.
- No documented action type for contract creation — worth saying so explicitly on the action-schema overview page so builders don't bounce looking for one.
- `list_action_schemas` returns input schemas but no output schemas; surfacing the keys an action emits would let agents stop hard-coding response paths.
