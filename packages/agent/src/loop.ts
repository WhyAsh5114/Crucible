/**
 * Core agentic loop for Crucible.
 *
 * Uses the Vercel AI SDK v6 `streamText` with an OpenAI-compatible provider.
 * Tools (read_file, write_file, run_shell, mcp_tool) are backed by injected
 * adapter functions so this module has no hard dependency on the backend's
 * Prisma client, PTY manager, or agent-bus — making it independently testable.
 *
 * The loop runs up to 20 model steps (`stopWhen: stepCountIs(20)`) and
 * publishes `AgentEvent`s to the bus via `adapter.publishEvent` so the
 * frontend's SSE stream receives live updates.
 */

import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { z } from 'zod';
import {
  CallIdSchema,
  InferenceReceiptIdSchema,
  StreamIdSchema,
  type AgentEvent,
  type CallId,
  type FallbackReason,
  type WorkspaceFile,
  mcp,
} from '@crucible/types';
import { buildSystemPrompt } from './system-prompt.ts';

// ── Public types ─────────────────────────────────────────────────────────────

/** OpenAI-compatible inference provider configuration. */
export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Which provider is serving this turn.
   * Defaults to 'openai-compatible' when not set.
   */
  provider?: '0g-compute' | 'openai-compatible';
  /**
   * Why inference fell back from the primary provider (0G Compute) to the
   * OpenAI-compatible path. Null when 0G is the active provider. Surfaced
   * in the inference_receipt event so the UI can show honest fallback state.
   */
  fallbackReason?: FallbackReason | null;
  /**
   * Per-server MCP endpoint URLs for the workspace container.
   * Key is the logical server name; value is the full MCP transport URL
   * (e.g. `http://127.0.0.1:32768/mcp`).
   * When present, the agent connects to that server directly via the AI SDK
   * MCP client rather than routing through the REST proxy in tool-exec.ts.
   */
  mcpServerUrls?: Partial<
    Record<'chain' | 'compiler' | 'deployer' | 'wallet' | 'memory' | 'terminal', string>
  >;
}

/**
 * All backend service calls the agent loop requires, injected by the caller.
 *
 * Using an adapter interface instead of direct imports keeps packages/agent
 * free of circular dependencies with packages/backend.
 */
export interface AgentAdapter {
  /** Return the current files in the workspace (used for context injection). */
  getWorkspaceFiles(workspaceId: string): Promise<WorkspaceFile[]>;

  /**
   * Write `content` to `filePath` (workspace-relative) and return the
   * resulting `WorkspaceFile` metadata (path, lang, hash, modifiedAt, …).
   */
  writeFile(workspaceId: string, filePath: string, content: string): Promise<WorkspaceFile>;

  /** Publish an event to the agent bus for this workspace. */
  publishEvent(workspaceId: string, event: AgentEvent): void;

  /** Allocate the next monotonic sequence number for this workspace's stream. */
  nextSeq(workspaceId: string): number;
}

// ── 0G Compute Router fetch wrapper ──────────────────────────────────────────

/**
 * Error thrown by the custom Router fetch when the upstream returns a non-2xx
 * status. Carries a classified `fallbackReason` so the agent loop can surface
 * a meaningful retry hint to the user via the `error` event.
 */
class OgRouterError extends Error {
  override readonly name = 'OgRouterError';
  readonly fallbackReason: FallbackReason;
  readonly status: number;

  constructor(message: string, status: number, fallbackReason: FallbackReason) {
    super(message);
    this.status = status;
    this.fallbackReason = fallbackReason;
  }
}

/**
 * Map a 0G Router HTTP error to a `FallbackReason`.
 *
 * See the Router error reference:
 * https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/errors
 */
function classifyRouterError(status: number, body: string): FallbackReason {
  if (status === 429) return 'rate_limited';
  if (status === 402 || /insufficient\s+balance/iu.test(body)) return 'balance_exhausted';
  return 'provider_unavailable';
}

/** Shape of the 0G Compute Router's trailing `x_0g_trace` SSE chunk. */
type OgTrace = {
  request_id?: string;
  provider?: string;
  billing?: { input_cost?: string; output_cost?: string; total_cost?: string };
  tee_verified?: boolean;
};

/**
 * Wrap a streaming response body to filter out 0G Router's proprietary
 * `x_0g_trace`-only SSE chunks. The Vercel AI SDK's OpenAI parser rejects
 * them (they have no `choices` / `error` field), causing a type validation
 * crash. Filtered chunks are forwarded to `onTrace` so billing/attestation
 * data can still be surfaced in the inference_receipt event.
 */
function filterOgTraceFromStream(
  body: ReadableStream<Uint8Array>,
  onTrace?: (t: OgTrace) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '';

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        const keep: string[] = [];
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const keys = Object.keys(parsed);
              if (keys.length === 1 && keys[0] === 'x_0g_trace') {
                onTrace?.(parsed['x_0g_trace'] as OgTrace);
                continue;
              }
            } catch {
              // Non-JSON or partial — pass through.
            }
          }
          keep.push(line);
        }

        if (keep.length > 0) {
          controller.enqueue(encoder.encode(keep.join('\n') + '\n'));
        }
      },
      flush(controller) {
        if (!buf) return;
        if (buf.startsWith('data: ') && buf !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(buf.slice(6)) as Record<string, unknown>;
            const keys = Object.keys(parsed);
            if (keys.length === 1 && keys[0] === 'x_0g_trace') {
              onTrace?.(parsed['x_0g_trace'] as OgTrace);
              return;
            }
          } catch {
            // Pass through.
          }
        }
        controller.enqueue(encoder.encode(buf));
      },
    }),
  );
}

/**
 * Recursively unwrap an error to find an `OgRouterError`. AI SDK wraps fetch
 * errors in `APICallError` / cause chains, so direct `instanceof` checks miss.
 */
function ogFallbackReasonOf(err: unknown): FallbackReason | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth++) {
    if (current instanceof OgRouterError) return current.fallbackReason;
    if (current instanceof Error && current.cause) {
      current = current.cause;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Build a `fetch` implementation for `createOpenAI` that:
 *   1. Injects `verify_tee: true` into chat-completion request bodies when the
 *      active provider is 0G Compute, asking the Router for a TEE attestation
 *      receipt (surfaced in the `x_0g_trace` field of the response).
 *   2. Throws a typed `OgRouterError` on non-2xx responses so the agent loop
 *      can classify the fallback reason and tell the UI how to recover.
 *   3. Filters the trailing `x_0g_trace`-only SSE chunk from streaming
 *      responses so the Vercel AI SDK parser never sees it (it has no `choices`
 *      or `error` field and fails schema validation).
 */
function makeOgRouterFetch(
  provider: AgentConfig['provider'],
  onOgTrace?: (t: OgTrace) => void,
): typeof globalThis.fetch | undefined {
  if (provider !== '0g-compute') return undefined;

  const wrapped = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    let nextInit = init;
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>;
        parsed['verify_tee'] = true;
        nextInit = { ...init, body: JSON.stringify(parsed) };
      } catch {
        // Non-JSON body — leave untouched.
      }
    }

    const response = await globalThis.fetch(input, nextInit);
    if (!response.ok) {
      const text = await response
        .clone()
        .text()
        .catch(() => '');
      throw new OgRouterError(
        `0G Compute Router error ${response.status}: ${text || response.statusText}`,
        response.status,
        classifyRouterError(response.status, text),
      );
    }

    // Filter x_0g_trace-only SSE chunks out of streaming responses.
    // We do NOT check content-type — the 0G Router omits or varies the header.
    if (response.body) {
      // Cast: response.body may be typed as ReadableStream<any> in some envs.
      const filteredBody = filterOgTraceFromStream(
        response.body as ReadableStream<Uint8Array>,
        onOgTrace,
      );
      return new Response(filteredBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  };
  return wrapped as typeof globalThis.fetch;
}

// ── MCP schema registry ──────────────────────────────────────────────────────

type McpServerKey = 'chain' | 'compiler' | 'deployer' | 'wallet' | 'memory' | 'terminal';

function getMcpSchemas(server: McpServerKey): Record<string, { inputSchema: z.ZodTypeAny }> {
  switch (server) {
    case 'chain':
      return {
        start_node: { inputSchema: mcp.chain.StartNodeInputSchema },
        get_state: { inputSchema: mcp.chain.GetStateInputSchema },
        snapshot: { inputSchema: mcp.chain.SnapshotInputSchema },
        revert: { inputSchema: mcp.chain.RevertInputSchema },
        mine: { inputSchema: mcp.chain.MineInputSchema },
        fork: { inputSchema: mcp.chain.ForkInputSchema },
      };
    case 'compiler':
      return {
        compile: { inputSchema: mcp.compiler.CompileInputSchema },
        list_contracts: { inputSchema: mcp.compiler.ListContractsInputSchema },
        get_abi: { inputSchema: mcp.compiler.GetAbiInputSchema },
        get_bytecode: { inputSchema: mcp.compiler.GetBytecodeInputSchema },
      };
    case 'deployer':
      return {
        deploy_local: { inputSchema: mcp.deployer.DeployLocalInputSchema },
        simulate_local: { inputSchema: mcp.deployer.SimulateLocalInputSchema },
        trace: { inputSchema: mcp.deployer.TraceInputSchema },
        call: { inputSchema: mcp.deployer.CallInputSchema },
        deploy_0g_chain: { inputSchema: mcp.deployer.DeployOgChainInputSchema },
      };
    case 'wallet':
      return {
        list_accounts: { inputSchema: mcp.wallet.ListAccountsInputSchema },
        get_balance: { inputSchema: mcp.wallet.GetBalanceInputSchema },
        sign_tx: { inputSchema: mcp.wallet.SignTxInputSchema },
        send_tx_local: { inputSchema: mcp.wallet.SendTxLocalInputSchema },
        switch_account: { inputSchema: mcp.wallet.SwitchAccountInputSchema },
      };
    case 'memory':
      return {
        recall: { inputSchema: mcp.memory.RecallInputSchema },
        remember: { inputSchema: mcp.memory.RememberInputSchema },
        list_patterns: { inputSchema: mcp.memory.ListPatternsInputSchema },
        provenance: { inputSchema: mcp.memory.ProvenanceInputSchema },
      };
    case 'terminal':
      return {
        create_session: { inputSchema: mcp.terminal.CreateSessionInputSchema },
        write: { inputSchema: mcp.terminal.WriteInputSchema },
        exec: { inputSchema: mcp.terminal.ExecInputSchema },
        resize: { inputSchema: mcp.terminal.ResizeInputSchema },
      };
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run one agent turn for `workspaceId` given a user `prompt`.
 *
 * Streams token deltas to the agent bus as `thinking` events, emits
 * `tool_call` / `tool_result` pairs around every tool invocation, and
 * finalises with a `message` + `inference_receipt` + `done` triple.
 *
 * Never throws — all errors are swallowed and forwarded to the bus as
 * `error` + `done` events so the frontend always gets a terminal frame.
 */
export async function runAgentTurn(
  workspaceId: string,
  prompt: string,
  config: AgentConfig,
  adapter: AgentAdapter,
): Promise<void> {
  const streamId = StreamIdSchema.parse(workspaceId);

  const baseEvent = (): { streamId: typeof streamId; seq: number; emittedAt: number } => ({
    streamId,
    seq: adapter.nextSeq(workspaceId),
    emittedAt: Date.now(),
  });

  const emit = (event: AgentEvent): void => adapter.publishEvent(workspaceId, event);

  // Echo the user's prompt so the chat rail shows it.
  emit({ ...baseEvent(), type: 'message', content: `**you:** ${prompt}` });

  // Collect workspace files for the system prompt.  Non-fatal if the
  // workspace directory doesn't exist yet.
  let files: WorkspaceFile[] = [];
  try {
    files = await adapter.getWorkspaceFiles(workspaceId);
  } catch {
    // Proceed without file context.
  }

  const ogFetch = makeOgRouterFetch(config.provider, (t) => {
    ogTraceRef.value = t;
  });
  const openai = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    ...(ogFetch ? { fetch: ogFetch } : {}),
  });

  let promptTokens = 0;
  let completionTokens = 0;
  // Use a ref object so TypeScript doesn't narrow this to `never` via control
  // flow analysis — the assignment happens inside a callback.
  const ogTraceRef: { value: OgTrace | null } = { value: null };

  // ── MCP client setup ───────────────────────────────────────────────────────
  const mcpClients: MCPClient[] = [];
  const mcpToolNames = new Set<string>();
  const toolToServer = new Map<string, string>(); // toolName → serverName for event emission
  const mcpToolsObj: Awaited<ReturnType<MCPClient['tools']>> = {};
  for (const [serverName, url] of Object.entries(config.mcpServerUrls ?? {})) {
    if (!url) continue;
    try {
      const client = await createMCPClient({ transport: { type: 'http', url } });
      mcpClients.push(client);
      const serverTools = await client.tools({
        schemas: getMcpSchemas(serverName as McpServerKey),
      });
      for (const name of Object.keys(serverTools)) {
        mcpToolNames.add(name);
        toolToServer.set(name, serverName);
      }
      Object.assign(mcpToolsObj, serverTools);
    } catch (err) {
      console.warn(
        `[agent] MCP client init failed for ${serverName}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // toolCallId → AgentEvent callId — links tool_call and tool_result events.
  const pendingMcpCalls = new Map<string, CallId>();

  try {
    const result = streamText({
      // Use .chat() to target /v1/chat/completions (standard SSE format).
      // The default callable routes to the Responses API (/v1/responses) which
      // uses text-start/text-delta/text-end — a format most compatible
      // providers don't implement, causing "text part not found" errors.
      model: openai.chat(config.model),
      system: buildSystemPrompt(files),
      messages: [{ role: 'user', content: prompt }],
      stopWhen: stepCountIs(20),
      maxRetries: 1,
      tools: {
        // ── read_file ──────────────────────────────────────────────────────
        read_file: tool({
          description:
            'Read the content of a file in the workspace. Use the workspace-relative path.',
          inputSchema: z.object({
            path: z
              .string()
              .min(1)
              .describe('Workspace-relative file path, e.g. "contracts/Lock.sol"'),
          }),
          execute: async ({ path: filePath }) => {
            try {
              const fresh = await adapter.getWorkspaceFiles(workspaceId);
              const file = fresh.find((f) => f.path === filePath);
              if (!file) return { ok: false as const, error: `File not found: ${filePath}` };
              return { ok: true as const, content: file.content ?? '' };
            } catch (err) {
              return {
                ok: false as const,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
        }),

        // ── write_file ─────────────────────────────────────────────────────
        write_file: tool({
          description: 'Write or overwrite a file in the workspace.',
          inputSchema: z.object({
            path: z
              .string()
              .min(1)
              .describe('Workspace-relative file path, e.g. "contracts/Lock.sol"'),
            content: z.string().describe('Complete file content to write'),
          }),
          execute: async ({ path: filePath, content }) => {
            try {
              const wf = await adapter.writeFile(workspaceId, filePath, content);
              emit({
                ...baseEvent(),
                type: 'file_write',
                path: wf.path,
                lang: wf.lang,
                hash: wf.hash,
                content: wf.content,
              });
              return { ok: true as const, path: wf.path, hash: wf.hash };
            } catch (err) {
              return {
                ok: false as const,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
        }),

        // ── MCP tools (connected directly via @ai-sdk/mcp) ────────────────
        ...mcpToolsObj,
      },
    });

    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case 'reasoning-delta':
          // Model's chain-of-thought / reasoning tokens — show as collapsible
          // "Thinking…" block in the chat rail.
          emit({ ...baseEvent(), type: 'thinking', text: chunk.text });
          break;

        case 'text-delta':
          // Stream each response token immediately so the chat rail updates
          // in real time. Token counts come from the 'finish' chunk.
          emit({ ...baseEvent(), type: 'message_delta', text: chunk.text });
          break;

        case 'finish':
          promptTokens = chunk.totalUsage.inputTokens ?? 0;
          completionTokens = chunk.totalUsage.outputTokens ?? 0;
          break;

        case 'tool-call':
          if (mcpToolNames.has(chunk.toolName)) {
            const callId = CallIdSchema.parse(crypto.randomUUID());
            pendingMcpCalls.set(chunk.toolCallId, callId);
            const serverName = toolToServer.get(chunk.toolName) ?? 'mcp';
            emit({
              ...baseEvent(),
              type: 'tool_call',
              callId,
              tool: `${serverName}.${chunk.toolName}`,
              args: chunk.input as Record<string, unknown>,
            });
          }
          break;

        case 'tool-result':
          if (mcpToolNames.has(chunk.toolName)) {
            const callId = pendingMcpCalls.get(chunk.toolCallId);
            if (callId) {
              pendingMcpCalls.delete(chunk.toolCallId);
              const raw = chunk.output as {
                isError?: boolean;
                content?: Array<{ type: string; text?: string }>;
              };
              if (raw.isError) {
                const error =
                  raw.content
                    ?.filter((c) => c.type === 'text')
                    .map((c) => c.text ?? '')
                    .join('\n') ?? 'MCP tool error';
                emit({
                  ...baseEvent(),
                  type: 'tool_result',
                  callId,
                  outcome: { ok: false, error },
                });
              } else {
                emit({
                  ...baseEvent(),
                  type: 'tool_result',
                  callId,
                  outcome: { ok: true, result: raw },
                });
              }
            }
          }
          break;

        case 'error': {
          const reason = ogFallbackReasonOf(chunk.error);
          emit({
            ...baseEvent(),
            type: 'error',
            message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
            ...(reason ? { ogFallbackReason: reason } : {}),
          });
          break;
        }

        default:
          break;
      }
    }
  } catch (err) {
    const reason = ogFallbackReasonOf(err);
    emit({
      ...baseEvent(),
      type: 'error',
      message: `Agent loop failed: ${err instanceof Error ? err.message : String(err)}`,
      ...(reason ? { ogFallbackReason: reason } : {}),
    });
    emit({ ...baseEvent(), type: 'done' });
    return;
  } finally {
    await Promise.all(mcpClients.map((c) => c.close().catch(() => undefined)));
  }

  // Emit inference receipt so the frontend can display cost / provenance.
  emit({
    ...baseEvent(),
    type: 'inference_receipt',
    receipt: {
      id: InferenceReceiptIdSchema.parse(crypto.randomUUID()),
      provider: config.provider ?? 'openai-compatible',
      model: config.model,
      attestation: ogTraceRef.value?.request_id ?? null,
      fallbackReason:
        config.provider === '0g-compute' ? null : (config.fallbackReason ?? 'admin_override'),
      promptTokens,
      completionTokens,
      createdAt: Date.now(),
    },
  });

  emit({ ...baseEvent(), type: 'done' });
}
