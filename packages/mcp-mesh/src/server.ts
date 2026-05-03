/**
 * mcp-mesh MCP server — Gensyn AXL peer-mesh wrapper.
 *
 * Exposes five tools to the agent via Model Context Protocol:
 *   list_peers         — list live peers visible in the AXL topology
 *   broadcast_help     — fan-out a structured help request to all peers
 *   collect_responses  — wait and drain peer responses for a given reqId
 *   respond            — send a verified patch back to a peer's request
 *   verify_peer_patch  — structural validation before applying a peer patch
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  ListPeersInputSchema,
  BroadcastHelpInputSchema,
  CollectResponsesInputSchema,
  RespondInputSchema,
  VerifyPeerPatchInputSchema,
  type BroadcastHelpInput,
  type CollectResponsesInput,
  type RespondInput,
  type VerifyPeerPatchInput,
} from '@crucible/types/mcp/mesh';
import type { AXLNodeManager } from './node-manager.ts';

const TAG = '[mcp-mesh]';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
const logError = (msg: string) => console.error(`${TAG} ${msg}`);

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createMeshServer(manager: AXLNodeManager): McpServer {
  const server = new McpServer({
    name: 'crucible-mesh',
    version: '0.0.0',
  });

  // ── list_peers ─────────────────────────────────────────────────────────

  server.registerTool(
    'list_peers',
    {
      title: 'List Mesh Peers',
      description:
        'Return the live peers currently visible in the AXL network topology. ' +
        'Use this to check connectivity before broadcasting a help request.',
      inputSchema: ListPeersInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        log('tool:list_peers');
        const output = await manager.listPeers();
        log(`tool:list_peers ok  count=${output.peers.length}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:list_peers error: ${String(err)}`);
        return errorResult(`list_peers failed: ${String(err)}`);
      }
    },
  );

  // ── broadcast_help ─────────────────────────────────────────────────────

  server.registerTool(
    'broadcast_help',
    {
      title: 'Broadcast Help Request',
      description:
        'Fan-out a structured debugging help request to all known peers on the AXL mesh. ' +
        'Include the revertSignature, full trace, contract source, and solc version. ' +
        'Returns a reqId to pass to collect_responses. ' +
        'Use this when memory.recall returns no hits and LLM reasoning alone is insufficient.',
      inputSchema: BroadcastHelpInputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input: BroadcastHelpInput) => {
      try {
        log(`tool:broadcast_help  sig=${input.revertSignature.slice(0, 32)}…`);
        const output = await manager.broadcastHelp(input);
        log(`tool:broadcast_help ok  reqId=${output.reqId}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:broadcast_help error: ${String(err)}`);
        return errorResult(`broadcast_help failed: ${String(err)}`);
      }
    },
  );

  // ── collect_responses ──────────────────────────────────────────────────

  server.registerTool(
    'collect_responses',
    {
      title: 'Collect Peer Responses',
      description:
        'Wait up to waitMs milliseconds for peer responses to arrive for the given reqId. ' +
        'Returns all collected MeshHelpResponse objects. ' +
        'Each response includes the peer patch (unified diff) and a verificationReceipt. ' +
        'Call verify_peer_patch before applying any patch.',
      inputSchema: CollectResponsesInputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input: CollectResponsesInput) => {
      try {
        log(`tool:collect_responses reqId=${input.reqId} waitMs=${input.waitMs ?? 10000}`);
        const output = await manager.collectResponses(input);
        log(`tool:collect_responses ok  count=${output.responses.length}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:collect_responses error: ${String(err)}`);
        return errorResult(`collect_responses failed: ${String(err)}`);
      }
    },
  );

  // ── respond ────────────────────────────────────────────────────────────

  server.registerTool(
    'respond',
    {
      title: 'Respond to Peer Help Request',
      description:
        'Send a verified patch back to the peer who broadcast the help request. ' +
        'Only call this after you have successfully verified the fix locally ' +
        '(snapshot → deploy → exercise the contract in your own Hardhat environment). ' +
        'The patch must be a valid unified diff.',
      inputSchema: RespondInputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input: RespondInput) => {
      try {
        log(`tool:respond reqId=${input.reqId}`);
        const output = await manager.respond(input);
        log(`tool:respond ok  reqId=${input.reqId}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:respond error: ${String(err)}`);
        return errorResult(`respond failed: ${String(err)}`);
      }
    },
  );

  // ── verify_peer_patch ──────────────────────────────────────────────────

  server.registerTool(
    'verify_peer_patch',
    {
      title: 'Verify Peer Patch (Structural)',
      description:
        'Validate a peer-provided patch structurally before attempting to apply it. ' +
        'Checks that the patch is a non-empty string and the verificationReceipt is a valid hash. ' +
        'Returns { result: "verified", localReceipt } on success, or { result: "failed", reason } on failure. ' +
        'After structural verification, apply the patch manually and re-run your chain tests to confirm.',
      inputSchema: VerifyPeerPatchInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input: VerifyPeerPatchInput) => {
      try {
        log(`tool:verify_peer_patch reqId=${input.response.reqId}`);
        const output = manager.verifyPeerPatch(input);
        log(`tool:verify_peer_patch result=${output.result}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:verify_peer_patch error: ${String(err)}`);
        return errorResult(`verify_peer_patch failed: ${String(err)}`);
      }
    },
  );

  return server;
}
