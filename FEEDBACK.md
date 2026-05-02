# KeeperHub Builder Feedback

> **Project:** Crucible — an AI-driven EVM contract development environment (ETHGlobal 2026)
> **Integration scope:** `POST /api/ship`, `simulate_bundle` / `execute_tx` / `get_execution_status` MCP tools in `mcp-deployer`, `ship_*` SSE agent events.

---

## 1. UX Friction — No Official SDK for Agentic Deployment Flows

**Category:** UX / DX
**Severity:** blocker

**What happened:**
When integrating KeeperHub into an agent-tool stack that is _not_ LangChain, there is no typed SDK for the REST API. Every third-party builder ends up hand-rolling an HTTP client — including normalizing status enums (`pending` / `running` / `success` / `error` → our internal `pending` / `mined` / `confirmed` / `failed`), mapping workflow API responses into agent-consumable DTOs, and adding exponential back-off for transient failures. This took approximately four hours of trial-and-error during the hackathon sprint and would have been eliminated by a small, framework-agnostic npm package (`@keeperhub/client`).

**Concrete suggestion:**
Publish a minimal `@keeperhub/client` package (ESM, zero runtime dependencies) that exports:

```ts
interface KeeperHubClient {
  createWorkflow(opts: WorkflowOpts): Promise<Workflow>;
  executeWorkflow(workflowId: string): Promise<ExecutionResult>;
  getExecutionStatus(executionId: string): Promise<StatusResult>;
  getExecutionLogs(executionId: string): Promise<LogsResult>;
  contractCall(opts: ContractCallOpts): Promise<CallResult>;
}
```

Include retry logic, typed status enums, and JSDoc so IDE auto-complete does the heavy lifting.

---

## 2. Documentation Gap — No Contract Deployment API Path

**Category:** Documentation Gap
**Severity:** blocker

**What happened:**
KeeperHub's documented Direct Execution API (`/api/execute/contract-call`, `/api/execute/transfer`) does not support contract deployment (CREATE transactions). The `contract-call` endpoint requires `contractAddress` (a required field), which doesn't exist yet for a new contract. There is no dedicated `/api/execute/deploy` endpoint.

**Reproduction steps:**

1. Read the Direct Execution API docs at `https://docs.keeperhub.com/api/direct-execution`.
2. Try to find an endpoint for deploying a new contract (sending a CREATE tx with bytecode).
3. The only option is `contract-call`, but it requires `contractAddress` as a mandatory field.

**Our workaround:**
We mapped contract deployment to the **Workflow API** instead:

1. `POST /api/workflows/create` — create a workflow with a `contractWrite` action node, `contractAddress` set to `0x0000000000000000000000000000000000000000`, and bytecode in the `data` field.
2. `POST /api/workflow/{workflowId}/execute` — execute the workflow.
3. `GET /api/workflows/executions/{executionId}/status` — poll until `success`.

This works but is undocumented and fragile — we had to reverse-engineer the node config schema by inspecting existing workflows via the API. The `actionType: "contractWrite"` node type and its expected `data` field are nowhere in the docs.

**Concrete suggestion:**
Either:

- Add a dedicated `POST /api/execute/deploy` endpoint that accepts `{ network, bytecode, constructorArgs, value }` and returns `{ executionId, contractAddress }`, OR
- Document the Workflow node schema for `contractWrite` actions, including how to set up a contract deployment node programmatically.

---

## 3. Documentation Gap — No End-to-End "Agentic Ship" Walkthrough

**Category:** Documentation
**Severity:** friction

**What's missing:**
The KeeperHub docs cover individual REST endpoints in isolation but do not have a complete sequence diagram or code sample for the full agent-driven deployment flow:

```
[agent] → POST /api/workflows/create (with contractWrite nodes)
        → POST /api/workflow/{id}/execute → get executionId
        → poll GET /api/workflows/executions/{executionId}/status until success
        → GET /api/workflows/executions/{executionId}/logs → extract runId as audit trail
```

In particular:

- Workflow execute (`POST /api/workflow/{id}/execute`) is **not idempotent** — calling it twice creates two separate execution runs. This is not documented.
- The Workflow API uses `/api/workflow/` (singular) for execute but `/api/workflows/` (plural) for everything else. This inconsistency caused multiple 404 errors during integration.
- The `runId` field in execution logs (e.g. `wrun_01KQKQ2C30M0NY2JY01RT59EY9`) appears to be the audit trail identifier, but this is never stated in the docs. Builders who don't know to look for it miss the compliance requirement.
- It is unclear how to recover a lost `executionId` if the process crashes between `execute` and the first status poll.

**Concrete suggestion:**
Add a single "Deploy a contract agentic-style" guide that covers the full workflow-based sequence, explicitly marks `execute` as non-idempotent, documents the singular/plural URL quirk, and shows how to extract the `runId` as the audit trail ID.

---

## 4. Feature Request — Expose Gas Estimate and Predicted Address in Simulation

**Category:** Feature Request
**Severity:** nice-to-have

**Context:**
Because KeeperHub lacks a standalone simulation endpoint, Crucible estimates gas locally based on bytecode size (base gas + per-byte cost + CREATE overhead). This is a rough approximation that can be off by 2-3x compared to actual on-chain execution.

**What would help:**

- A `POST /api/execute/simulate` endpoint that accepts the same payload as a workflow execution but dry-runs it without broadcasting. Returns `gasEstimate`, `effectiveGasPriceGwei`, and `predictedContractAddress` (for CREATE txs).
- Alternatively, add a `dryRun: true` flag to `POST /api/workflow/{id}/execute` that simulates without broadcasting and returns estimated gas + predicted addresses.

This would let agents display accurate cost estimates in a "ship preview" card before the user confirms, without an extra `eth_gasPrice` RPC round-trip or local nonce derivation.

---

## 5. Bug — Execution Logs Do Not Expose `txHash` or `contractAddress` After Confirmed Deployment

**Category:** Bug
**Severity:** high

**What happened:**
After a successful `contractWrite` workflow execution reaches `status: "confirmed"`, the execution logs endpoint (`GET /api/workflows/executions/{executionId}/logs`) returns node output objects that do **not** contain `transactionHash`, `txHash`, or `contractAddress` fields, even though the deployment landed on-chain. The `status` field confirms success, but the deployment artifact data is absent.

**Reproduction steps:**

1. `POST /api/workflows/create` — create a workflow with a `contractWrite` deployment node.
2. `POST /api/workflow/{id}/execute` — get `executionId`.
3. `GET /api/workflows/executions/{executionId}/status` → `status: "success"` (confirmed).
4. `GET /api/workflows/executions/{executionId}/logs` → inspect `nodeLogs[*].output`.
5. None of the expected keys (`transactionHash`, `txHash`, `contractAddress`, `deployedAddress`) are present in the output.

**Impact:**

- The deployed contract address is not recoverable through the API. Builders must query Etherscan or the chain directly using the deployer wallet's nonce to find it.
- Audit pipelines that rely on `contractAddress` from the logs (e.g. for track submission) cannot be automated.
- `auditTrailId` (`wrun_*`) is still recoverable via `logs.execution.runId`, so the compliance record exists — but the deployment artifact data is missing.

**Concrete suggestion:**
Populate `nodeLogs[n].output` with at least `{ transactionHash, contractAddress, blockNumber, gasUsed }` for `contractWrite` action nodes once the tx is confirmed. This is consistent with what EVM nodes return for a transaction receipt and is the minimum builders need to close the loop without an out-of-band chain query.
