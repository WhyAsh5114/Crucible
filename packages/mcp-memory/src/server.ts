import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  RecallInputSchema,
  RememberInputSchema,
  ListPatternsInputSchema,
  ProvenanceInputSchema,
  type RecallInput,
  type RememberInput,
  type ListPatternsInput,
  type ProvenanceInput,
} from '@crucible/types/mcp/memory';
import { createMemoryService } from './service.ts';

const TAG = '[mcp-memory]';
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

export function createMemoryServer(opts: { workspaceRoot: string }): McpServer {
  const service = createMemoryService(opts);
  const server = new McpServer({
    name: 'crucible-memory',
    version: '0.0.0',
  });

  server.registerTool(
    'recall',
    {
      title: 'Recall Similar Patterns',
      description: 'Return top matching patterns for a revert signature or freeform query.',
      inputSchema: RecallInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: RecallInput) => {
      try {
        log('tool:recall');
        const output = await service.recall(input);
        log(`tool:recall ok  hits=${output.hits.length}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:recall error: ${String(err)}`);
        return errorResult(`recall failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember Verified Fix Pattern',
      description: 'Append a verified revert->patch pattern into local memory storage.',
      inputSchema: RememberInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input: RememberInput) => {
      try {
        log('tool:remember');
        const output = await service.remember(input);
        log(`tool:remember ok  id=${output.id}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:remember error: ${String(err)}`);
        return errorResult(`remember failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'list_patterns',
    {
      title: 'List Stored Patterns',
      description: 'List patterns with cursor-based pagination and optional scope filter.',
      inputSchema: ListPatternsInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: ListPatternsInput) => {
      try {
        log('tool:list_patterns');
        const output = await service.listPatterns(input);
        log(`tool:list_patterns ok  count=${output.patterns.length}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:list_patterns error: ${String(err)}`);
        return errorResult(`list_patterns failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'provenance',
    {
      title: 'Get Pattern Provenance',
      description: 'Return provenance information for a stored memory pattern by id.',
      inputSchema: ProvenanceInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: ProvenanceInput) => {
      try {
        log(`tool:provenance id=${input.id}`);
        const output = await service.provenance(input);
        return toolResult(output);
      } catch (err) {
        logError(`tool:provenance error: ${String(err)}`);
        return errorResult(`provenance failed: ${String(err)}`);
      }
    },
  );

  return server;
}
