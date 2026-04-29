# KeeperHub MCP Integration Feedback

**Project:** Crucible — AI-powered browser IDE for Web3 dApps
**Integration Stack:** OpenClaw (TypeScript agent framework) + KeeperHub MCP
**Date:** 2026-04-29
**Reviewer:** wengkit218-pixel

---

## Overview

This document captures feedback from integrating KeeperHub MCP into the Crucible project's "Ship to Public Chain" flow. Our stack uses OpenClaw (a non-LangChain agent framework) with custom MCP servers for contract compilation, deployment, and chain interaction.

---

## 1. UX Friction: Missing Type Definitions for MCP Protocol

**Severity:** Friction

**Description:**
The `@keeperhub/mcp-sdk` package ships without TypeScript type definitions. When integrating into a TypeScript-heavy project, we had to manually create `*.d.ts` files for the MCP protocol types (Tool definitions, Request/Response schemas). This added ~2 hours of setup time and introduced potential for type mismatches.

**Impact:**
- IDE autocomplete doesn't work for MCP tool parameters
- Runtime errors from typos in tool names (e.g., `simulate_bundle` vs `simulateBundle`)
- Manual sync required between our types and upstream changes

**Suggested Fix:**
Publish `@types/keeperhub__mcp-sdk` to DefinitelyTyped, or include `.d.ts` files in the main package.

---

## 2. Documentation Gap: OpenClaw Integration Example

**Severity:** Blocker

**Description:**
The KeeperHub docs only show LangChain integration examples. Our project uses OpenClaw's agent runtime, which has a different tool registration pattern. We had to reverse-engineer the MCP protocol by reading the source code.

Specific missing documentation:
- How to register MCP tools with non-LangChain agent frameworks
- WebSocket vs HTTP transport configuration
- Error handling patterns for async tool execution

**Reproduction:**
1. Visit https://docs.keeperhub.xyz/integration
2. All examples assume `langchain` imports
3. No reference to `McpServer` class usage outside LangChain

**Workaround:**
We read the `keeperhub-mcp-server` source to understand the protocol:

```typescript
// Our OpenClaw integration pattern (not documented anywhere)
import { McpServer } from '@keeperhub/mcp-sdk';

const server = new McpServer({ name: 'crucible-ship', version: '1.0.0' });
server.tool('simulate_bundle', simulateBundleSchema, async (params) => {
  // ... implementation
});
await server.connect(new StdioServerTransport());
```

---

## 3. Feature Request: Bundle Simulation Gas Estimates

**Severity:** Nice-to-have

**Description:**
The `simulate_bundle` endpoint returns whether a bundle will succeed, but doesn't provide per-transaction gas estimates. For our "Ship" UI, we need to show users:

- Gas estimate per transaction in the bundle
- Total gas cost in ETH/fiat
- Gas optimization suggestions (e.g., combine operations)

**Current Behavior:**
```json
{
  "success": true,
  "results": [{ "status": "success" }, { "status": "success" }]
}
```

**Requested Behavior:**
```json
{
  "success": true,
  "results": [
    { "status": "success", "gasUsed": 125000, "gasEstimate": "0.0025 ETH" },
    { "status": "success", "gasUsed": 45000, "gasEstimate": "0.0009 ETH" }
  ],
  "totalGasEstimate": "0.0034 ETH"
}
```

---

## 4. Reproducible Bug: Websocket Reconnection Race Condition

**Severity:** Blocker

**Description:**
When the KeeperHub MCP server restarts (e.g., during deployment), the WebSocket client attempts to reconnect. However, pending requests from before the disconnect never resolve or reject — they hang indefinitely.

**Reproduction Steps:**
1. Connect to KeeperHub MCP via WebSocket
2. Call `simulate_bundle` with a long-running simulation
3. Restart the KeeperHub server during simulation
4. Observe: Promise never resolves, no error thrown
5. Client appears connected but is in broken state

**Expected:**
Pending requests should reject with a `ConnectionLost` error, allowing the client to retry.

**Workaround:**
We implemented a 30-second timeout wrapper around all MCP calls:

```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
}
```

---

## Summary

| Category | Count | Blockers | Friction | Nice-to-have |
|----------|-------|----------|----------|--------------|
| UX Friction | 1 | 0 | 1 | 0 |
| Documentation Gaps | 1 | 1 | 0 | 0 |
| Feature Requests | 1 | 0 | 0 | 1 |
| Reproducible Bugs | 1 | 1 | 0 | 0 |

**Total Items:** 4

---

## Conclusion

KeeperHub MCP provides a solid foundation for transaction bundling and execution, but the integration experience could be improved with better TypeScript support and framework-agnostic documentation. The websocket reconnection bug is the most critical issue for production use.

We're happy to contribute fixes for the type definitions and documentation if the team is open to external contributions.
