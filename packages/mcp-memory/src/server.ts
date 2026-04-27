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

  // ── prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'memory_workflow',
    {
      title: 'Memory Workflow',
      description:
        'Guide for storing and retrieving verified revert-fix patterns using crucible-memory.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are connected to the crucible-memory MCP server.',
              'It stores and retrieves verified revert→fix patterns to accelerate debugging.',
              '',
              'Typical workflow:',
              '1. Call recall(query) with a revert signature or freeform description.',
              '   - Returns top matching patterns ranked by similarity.',
              '   - Each hit includes revertSignature, fix, contractName, and provenance.',
              '2. Apply the suggested fix from the top hit to your contract or transaction.',
              '3. Verify the fix resolves the issue (re-simulate in crucible-deployer).',
              '4. Call remember(pattern) to persist the confirmed fix for future use.',
              '   - Required fields: revertSignature, fix, contractName.',
              '   - Optional: scope (file path), tags, notes.',
              '5. Call list_patterns for paginated browsing of all stored patterns.',
              '6. Call provenance(id) to see the source and timestamps for a specific pattern.',
              '',
              'Tool reference:',
              '  recall         — Semantic search over stored patterns.',
              '  remember       — Persist a verified revert→fix pattern.',
              '  list_patterns  — Paginated list of all patterns.',
              '  provenance     — Full metadata for a pattern by id.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'debug_and_learn',
    {
      title: 'Debug & Learn Loop',
      description:
        'Guide for using crucible-memory together with crucible-deployer to diagnose reverts and build up a fix-pattern library.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Debug-and-learn loop using crucible-deployer and crucible-memory:',
              '',
              '1. [deployer]  simulate_local or trace → extract the revert signature.',
              '2. [memory]    recall(revertSignature) → check if a fix pattern already exists.',
              '   a) Hit found   → apply the suggested fix, skip to step 5.',
              '   b) No hit      → investigate manually (steps 3–4).',
              '3. Diagnose the root cause from the trace (call stack, storage, events).',
              '4. Apply a fix to the contract or transaction inputs.',
              '5. [deployer]  simulate_local again → confirm the revert is resolved.',
              '6. [memory]    remember({ revertSignature, fix, contractName, ... })',
              '   - Captures the revert→fix mapping so future agents can skip steps 3–4.',
              '',
              'Over time this builds a project-specific fix library that reduces debugging time.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
