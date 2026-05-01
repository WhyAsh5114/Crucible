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

// ── OpenAI-compat response normalisation ────────────────────────────────────

/**
 * Some OpenAI-compatible providers (DigitalOcean's serverless inference,
 * Zhipu glm-5, Moonshot kimi) emit `tool_calls[].type: ""` on streaming
 * deltas instead of the spec-required `"function"`. The Vercel AI SDK
 * validates incoming chunks with a strict zod schema and rejects anything
 * else, blowing up the agent loop on every tool call.
 *
 * This fetch wrapper transforms the SSE response body line-by-line, parsing
 * each `data: {...}` JSON payload, fixing empty `type` strings, and
 * re-emitting. Non-streaming responses pass through untouched. Errors during
 * parsing are swallowed silently — the original chunk is forwarded as-is so
 * the SDK can still handle it (or report its own validation error).
 */
// Typed loosely on purpose — the AI SDK passes whatever it would pass to the
// global `fetch`, and we just forward verbatim. Using DOM-typed `RequestInfo`
// would force pulling DOM lib into the agent package's tsconfig.
async function normalizingFetch(input: unknown, init?: unknown): Promise<Response> {
  const res = await (fetch as unknown as (i: unknown, x?: unknown) => Promise<Response>)(
    input,
    init,
  );
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/event-stream') || !res.body) return res;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      const out: string[] = [];
      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          out.push(line);
          continue;
        }
        const payload = line.slice(6);
        if (payload === '[DONE]') {
          out.push(line);
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                tool_calls?: Array<{ type?: string; function?: unknown }>;
              };
            }>;
          };
          const calls = parsed.choices?.[0]?.delta?.tool_calls;
          if (Array.isArray(calls)) {
            for (const call of calls) {
              if (call && typeof call === 'object' && (!call.type || call.type === '')) {
                call.type = 'function';
              }
            }
            out.push(`data: ${JSON.stringify(parsed)}`);
          } else {
            out.push(line);
          }
        } catch {
          out.push(line);
        }
      }
      controller.enqueue(encoder.encode(out.join('\n')));
    },
  });

  // The Response body stream is typed loosely across `stream/web` vs.
  // `node:stream/web`; the runtime contract is identical so we cast through
  // unknown rather than fight the types.
  const transformed = (res.body as unknown as ReadableStream<Uint8Array>).pipeThrough(transform);
  // `BodyInit` is a DOM type; the runtime accepts the transformed stream, so
  // cast through unknown rather than pulling DOM lib into the package config.
  return new Response(transformed as unknown as ReadableStream<Uint8Array>, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

// ── Public types ─────────────────────────────────────────────────────────────

/** OpenAI-compatible inference provider configuration. */
export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Extra HTTP headers injected on every request.
   * Used for 0G Compute per-request signed auth headers.
   */
  headers?: Record<string, string>;
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
  /**
   * Custom fetch passed through to the MCP HTTP transport. Used by the
   * control plane to inject a loopback-aware fetch (Connection: close +
   * retry-on-socket-close) for backend → docker-published runtime hops where
   * Bun's keep-alive pool races docker-proxy idle timeouts.
   */
  mcpFetch?: typeof fetch;
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
 *
 * Pass `signal` to allow the caller to cancel the turn mid-flight. When the
 * signal aborts, the active `streamText` call rejects with an AbortError; the
 * loop catches it, emits a "cancelled by user" message + `done`, and returns.
 */
export async function runAgentTurn(
  workspaceId: string,
  prompt: string,
  config: AgentConfig,
  adapter: AgentAdapter,
  signal?: AbortSignal,
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

  const openai = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    ...(config.headers ? { headers: config.headers } : {}),
    // Some OpenAI-compatible providers (observed: DigitalOcean Serverless
    // Inference for glm-5 and kimi-k2.5) emit `tool_calls[].type: ""` on
    // streaming deltas instead of either `"function"` or omitting the field.
    // The AI SDK validates incoming chunks with a strict zod schema and
    // rejects them, blowing up the agent loop. Other models on the same
    // endpoint (e.g. Llama 3.3, Qwen 3) appear compliant — but the wrapper
    // is a no-op for compliant streams, so it stays on unconditionally.
    // Cast through unknown: the AI SDK's `fetch` field uses DOM types we
    // intentionally don't pull into this package's tsconfig.
    fetch: normalizingFetch as unknown as typeof fetch,
  });

  let promptTokens = 0;
  let completionTokens = 0;

  // ── MCP client setup ───────────────────────────────────────────────────────
  const mcpClients: MCPClient[] = [];
  const mcpToolNames = new Set<string>();
  const toolToServer = new Map<string, string>(); // toolName → serverName for event emission
  const mcpToolsObj: Awaited<ReturnType<MCPClient['tools']>> = {};
  for (const [serverName, url] of Object.entries(config.mcpServerUrls ?? {})) {
    if (!url) continue;
    try {
      const client = await createMCPClient({
        transport: {
          type: 'http',
          url,
          ...(config.mcpFetch ? { fetch: config.mcpFetch } : {}),
        },
      });
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
      ...(signal ? { abortSignal: signal } : {}),
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

        case 'error':
          emit({
            ...baseEvent(),
            type: 'error',
            message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
          });
          break;

        default:
          break;
      }
    }
  } catch (err) {
    // Aborts come back either as native AbortError or with `signal.aborted`
    // already set — surface them as a user-facing cancel notice rather than
    // a generic agent-loop failure.
    const aborted =
      signal?.aborted === true ||
      (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message)));
    if (aborted) {
      emit({ ...baseEvent(), type: 'message', content: '_Cancelled by user._' });
    } else {
      emit({
        ...baseEvent(),
        type: 'error',
        message: `Agent loop failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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
      attestation: null,
      fallbackReason:
        config.provider === '0g-compute' ? null : (config.fallbackReason ?? 'admin_override'),
      promptTokens,
      completionTokens,
      createdAt: Date.now(),
    },
  });

  emit({ ...baseEvent(), type: 'done' });
}
