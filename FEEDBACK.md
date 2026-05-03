# KeeperHub Builder Feedback

> **Project:** Crucible — an AI-driven EVM contract development environment (ETHGlobal Open Agents 2026)
> **Integration scope:** Crucible's agent loop connects to KeeperHub's hosted MCP server (`https://app.keeperhub.com/mcp`) on every turn when `KEEPERHUB_API_KEY` is set in the backend env. The agent gets the full KeeperHub tool surface (workflow CRUD, AI workflow generation, action-schema discovery, wallet integrations, direct execution) namespaced as `keeperhub_*` alongside Crucible's own MCP servers. This feedback is based on building that integration end-to-end against the documented MCP and REST APIs — no internal endpoints, no reverse-engineered shapes.

---

## 1. UX Friction — Hosted MCP authentication is a Bearer header but onboarding docs lead with OAuth

**Category:** UX / DX
**Severity:** medium

**What happened:**
KeeperHub's hosted MCP at `https://app.keeperhub.com/mcp` accepts a simple `Authorization: Bearer kh_…` header. That is the right primitive for a server-to-server agent like Crucible. The "Getting started → MCP" docs, however, lead with the Claude Desktop / OAuth flow, which made it look (initially) like the only supported auth mode for the hosted MCP was an interactive browser handshake.

It took a careful read of the MCP transport spec and a probe with the Vercel AI SDK's `createMCPClient({ transport: { type: 'http', headers: { Authorization: 'Bearer …' } } })` to discover that org API keys work as Bearer tokens against the hosted endpoint. That single fact unlocked the entire agent integration.

**Concrete suggestion:**
Add a one-paragraph "Programmatic clients (server-side)" section directly under the MCP onboarding header:

> If you're connecting from a backend / agent runtime, set the HTTP transport URL to `https://app.keeperhub.com/mcp` and pass your org API key as `Authorization: Bearer kh_…`. OAuth is only needed for end-user-attached clients (Claude Desktop, ChatGPT).

Even better: a copy-pasteable snippet for the three most popular SDKs (`@modelcontextprotocol/sdk`, `@ai-sdk/mcp`, `mcp-use`) showing the headers being passed through.

---

## 2. Documentation Gap — `network` field expects a chainId string, but example values use names

**Category:** Documentation Gap
**Severity:** medium

**What happened:**
Several action schemas accept a `network` field. Example values in the public docs use names ("sepolia", "ethereum", "base"). The actual API rejects names and requires the chainId as a **string** (`"11155111"` for Sepolia, not the integer `11155111`, and not `"sepolia"`). The error message is generic enough that builders will assume their request body is malformed elsewhere before they think to coerce the network field.

**Concrete suggestion:**

- Standardise on chainId-string in both the schema and the docs. Mention explicitly that it is a stringified decimal chainId, not a name and not an int.
- If accepting names is a long-term goal, do it server-side and document the canonical names list.

---

## 3. Documentation Gap — `web3/write-contract` requires `walletId`; the discovery path isn't obvious

**Category:** Documentation
**Severity:** medium

**What happened:**
Web3 write actions (`web3/write-contract`, `web3/transfer-funds`, `web3/transfer-token`) all require a `walletId`. The action docs describe the field but don't say where the ID comes from. The answer is `keeperhub_get_wallet_integration` (or the corresponding REST endpoint), but a builder hitting `web3/write-contract` first will get an opaque 422 before they think to enumerate wallet integrations.

**Concrete suggestion:**
Cross-link from the write-action docs to the wallet-integration endpoint with one line of context:

> `walletId` is the identifier returned by `GET /api/wallet-integrations` (or the `keeperhub_get_wallet_integration` MCP tool). Each integration is scoped to one chainId.

Bonus: when the API rejects a write action because `walletId` is missing or wrong-chain, return an error message that includes the required chainId and a hint to call `get_wallet_integration` for that chain.

---

## 4. Feature Request — Document (or expose) which action types support contract creation

**Category:** Feature Request
**Severity:** nice-to-have

**Context:**
The published action-schema list covers calling existing contracts (`web3/write-contract`, `web3/read-contract`) and value transfers (`web3/transfer-funds`, `web3/transfer-token`). There is no documented action type for sending a CREATE transaction (deploying a new contract). Crucible side-steps this by deploying through its own toolchain (local Hardhat + 0G Galileo) and then using KeeperHub purely for post-deploy automation against the resulting address — but this is exactly the question every Open Agents builder will ask in the first ten minutes.

**Concrete suggestion:**

- If contract creation is intentionally out of scope, say so on the action-schema overview page in one sentence: "KeeperHub orchestrates calls to deployed contracts; deployment is left to your own toolchain or your wallet provider's deploy flow."
- If it's coming, a `web3/deploy-contract` action that takes `{ walletId, network, bytecode, constructorArgs?, value? }` and surfaces `contractAddress` + `txHash` in the execution output would be very welcome.

---

## 5. Feature Request — Surface execution output keys in the action-schema response

**Category:** Feature Request
**Severity:** nice-to-have

**Context:**
`keeperhub_list_action_schemas` returns the **input** schema for each action type, which is excellent — it tells the agent exactly what fields it needs to populate. The matching **output** shape (what keys land in the execution log when the action succeeds) isn't returned. As a result, the agent has to either run a probe execution and inspect the result, or hard-code per-action knowledge ("for `web3/write-contract` you read `txHash` from `nodeLogs[*].output.transactionHash`") which is exactly the kind of fragility MCP-style discovery is supposed to eliminate.

**Concrete suggestion:**
Extend each entry in the action-schema response with an `outputSchema` (mirroring the `inputSchema` style). Even a JSON schema with the four or five keys the action emits on success would make agent integrations much more robust against future additions.

---

## What worked very well

To balance the suggestions above, four things made KeeperHub a pleasure to integrate:

1. **The MCP server is a real MCP server.** `tools/list` works, the schemas come back rich, and pairing it with `@ai-sdk/mcp`'s `schemas: 'automatic'` discovery means Crucible's agent picks up new KeeperHub tools the moment they ship — no client-side rebuilds.
2. **AI workflow generation (`ai_generate_workflow`) is a killer feature** for an agent. The agent can describe a keeper in natural language ("every hour, if `Vault.totalSupply()` > 1000, call `rebalance()`") and get back a workflow draft to refine. This is a strictly higher-leverage interface than wiring action nodes by hand.
3. **The Direct Execution API** is the right escape hatch for "fire one call now" flows that don't need a stored workflow.
4. **Error responses are JSON with stable shapes.** Once the chainId-string and walletId issues above are sorted, the rest of the integration is a straight read-the-docs-and-do-it experience.
