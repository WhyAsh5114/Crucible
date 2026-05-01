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

import { streamText, tool, stepCountIs, type ToolSet } from 'ai';
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
export function classifyRouterError(status: number, body: string): FallbackReason {
  if (status === 429) return 'rate_limited';
  if (status === 402 || /insufficient\s+balance/iu.test(body)) return 'balance_exhausted';
  return 'provider_unavailable';
}

/** Shape of the 0G Compute Router's trailing `x_0g_trace` SSE chunk. */
export type OgTrace = {
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
export function filterOgTraceFromStream(
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
export function ogFallbackReasonOf(err: unknown): FallbackReason | undefined {
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

    // Use the normalising fetch under the hood so non-conformant
    // OpenAI-compatible providers behind the 0G Router (e.g. providers that
    // emit `tool_calls[].type: ""` on streaming deltas) don't blow up the AI
    // SDK's strict schema validation. The wrapper is a no-op for compliant
    // streams.
    const response = await normalizingFetch(input, nextInit);
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
        deploy_og_chain: { inputSchema: mcp.deployer.DeployOgChainInputSchema },
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

// ── Repair loop types ────────────────────────────────────────────────────────

/**
 * Phases of the self-healing repair sub-loop.
 *
 * The `prepareStep` callback transitions through these in order each time a
 * revert is detected. The LLM receives a narrowed `activeTools` + forced
 * `toolChoice` per phase so it cannot stray from the repair sequence.
 *
 *   idle       — normal operation (no active repair)
 *   snapshot   — chain.snapshot (save state before repair attempt)
 *   trace      — deployer.trace (get EVM trace of the reverting tx)
 *   recall     — memory.recall  (look up known fix patterns)
 *   patch      — write_file     (apply the fix to the .sol source)
 *   compile    — compiler.compile
 *   revert     — chain.revert   (reset to snapshot)
 *   deploy     — deployer.deploy_local (verify the fix)
 */
type RepairPhase =
  | 'idle'
  | 'snapshot'
  | 'trace'
  | 'recall'
  | 'patch'
  | 'compile'
  | 'revert'
  | 'deploy';

/** Mutable repair-loop state threaded through experimental_context. */
interface RepairContext {
  phase: RepairPhase;
  /** How many repair attempts have started (incremented on each 'snapshot' entry). */
  attempts: number;
  /** The revert signature that triggered the current repair loop. */
  revertSignature: string;
  /** The txHash of the reverting deploy (for the trace call). */
  revertTxHash: string;
  /** The snapshotId from chain.snapshot so we can revert after patching. */
  snapshotId: string | null;
  /** The compiled contract name being deployed (for compile + redeploy). */
  contractName: string;
  /** The sourcePath of the .sol file being fixed (for compile step). */
  sourcePath: string;
}

/** Per-phase tool restriction tables. */
const REPAIR_PHASE_TOOLS: Record<
  Exclude<RepairPhase, 'idle'>,
  { activeTools: string[]; toolName: string }
> = {
  snapshot: { activeTools: ['snapshot'], toolName: 'snapshot' },
  trace: { activeTools: ['trace'], toolName: 'trace' },
  recall: { activeTools: ['recall'], toolName: 'recall' },
  patch: { activeTools: ['write_file'], toolName: 'write_file' },
  compile: { activeTools: ['compile'], toolName: 'compile' },
  revert: { activeTools: ['revert'], toolName: 'revert' },
  deploy: { activeTools: ['deploy_local'], toolName: 'deploy_local' },
};

// ── Repair loop helpers ───────────────────────────────────────────────────────

/**
 * Detect whether a `deploy_local` tool result contains a revert.
 * Returns `{ reverted: true, txHash, revertSignature }` or `{ reverted: false }`.
 */
export function extractDeployRevert(
  toolName: string,
  toolResult: unknown,
): { reverted: false } | { reverted: true; txHash: string; revertSignature: string } {
  if (toolName !== 'deploy_local') return { reverted: false };
  // MCP tool results come back as { isError?: boolean; content?: [{type:'text',text:string}] }
  // A revert surfaces as isError:true with the revert reason in the text.
  const raw = toolResult as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  if (!raw.isError) return { reverted: false };
  const message =
    raw.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n') ?? '';
  // Only treat as a revert if the error message actually describes an EVM
  // revert. Infrastructure errors (e.g. "contract not found in artifact store",
  // "node not running") must not trigger the repair loop.
  const isRevertMessage = /revert/i.test(message) || /0x[0-9a-f]{64}/i.test(message);
  if (!isRevertMessage) return { reverted: false };
  // Extract txHash from common Hardhat revert messages, e.g.
  // "Transaction reverted: 0xabc... reverted with reason: …"
  const txMatch = /0x[0-9a-f]{64}/i.exec(message);
  const txHash = txMatch?.[0] ?? '0x' + '0'.repeat(64);
  // Normalise a revert signature: prefer decoded reason string; fall back to
  // first 4 bytes as a selector if present; otherwise use the raw message.
  const reasonMatch = /reverted with reason:\s*"([^"]+)"/i.exec(message);
  const revertSignature = reasonMatch?.[1] ?? message.slice(0, 200);
  return { reverted: true, txHash, revertSignature };
}

/**
 * Extract the snapshotId from a `chain.snapshot` tool result.
 * Returns null on any parsing failure.
 */
export function extractSnapshotId(toolResult: unknown): string | null {
  try {
    const raw = toolResult as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string }>;
    };
    if (raw.isError) return null;
    const text = raw.content?.find((c) => c.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text) as { snapshotId?: string };
    return parsed.snapshotId ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect a reverted `send_tx_local` call.
 *
 * `send_tx_local` succeeds at the MCP level (`isError: false`) but returns
 * `status: 'reverted'` in the JSON body when the EVM transaction reverted.
 * The `txHash` in the body is a REAL mined transaction — it can be passed to
 * `deployer.trace` to decode the revert reason.
 */
export function extractSendTxRevert(
  toolName: string,
  toolResult: unknown,
): { reverted: false } | { reverted: true; txHash: string; revertSignature: string } {
  if (toolName !== 'send_tx_local') return { reverted: false };
  const raw = toolResult as
    | { isError?: boolean; content?: Array<{ type: string; text?: string }> }
    | null
    | undefined;
  if (!raw || raw.isError) return { reverted: false };
  const text = raw.content?.find((c) => c.type === 'text')?.text ?? '';
  try {
    const parsed = JSON.parse(text) as { status?: string; txHash?: string };
    if (parsed.status === 'reverted') {
      const txHash = parsed.txHash ?? '0x' + '0'.repeat(64);
      return {
        reverted: true,
        txHash,
        // Revert reason is not in send_tx_local output — the trace step will
        // decode it from the mined transaction via debug_traceTransaction.
        revertSignature: `transaction reverted (${txHash.slice(0, 10)}…)`,
      };
    }
  } catch {
    // Not JSON — no revert detected.
  }
  return { reverted: false };
}

/**
 * Extract the deployed contract name and sourcePath from a deploy_local success result.
 * Used to seed the repair context for compile/redeploy.
 */
export function extractDeployMeta(
  toolName: string,
  toolArgs: unknown,
): { contractName: string; sourcePath: string } | null {
  if (toolName !== 'deploy_local') return null;
  const args = toolArgs as { contractName?: string; sourcePath?: string };
  if (!args.contractName) return null;
  return {
    contractName: args.contractName,
    // sourcePath may not be in args; fall back to "contracts/<Name>.sol"
    sourcePath: args.sourcePath ?? `contracts/${args.contractName}.sol`,
  };
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
  emit({ ...baseEvent(), type: 'user_prompt', content: prompt });

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
  // Always install a normalising fetch wrapper. Some OpenAI-compatible
  // providers (observed: DigitalOcean Serverless Inference for glm-5 and
  // kimi-k2.5; some 0G Router providers) emit `tool_calls[].type: ""` on
  // streaming deltas instead of `"function"`. The AI SDK validates incoming
  // chunks with a strict zod schema and rejects them, blowing up the loop.
  // The wrapper is a no-op for compliant streams. When 0G is the active
  // provider, ogFetch *also* wraps normalizingFetch under the hood (see
  // makeOgRouterFetch above) so verify_tee injection and trace filtering
  // compose with the normalisation pass.
  // Cast through unknown: the AI SDK's `fetch` field uses DOM types we
  // intentionally don't pull into this package's tsconfig.
  const openai = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    fetch: (ogFetch ?? normalizingFetch) as unknown as typeof fetch,
  });

  let promptTokens = 0;
  let completionTokens = 0;
  // Use a ref object so TypeScript doesn't narrow this to `never` via control
  // flow analysis — the assignment happens inside a callback.
  const ogTraceRef: { value: OgTrace | null } = { value: null };
  // Captures the FallbackReason of any 0G Router failure so the
  // inference_receipt emitted at the end can surface it on the receipt itself
  // (in addition to the standalone `error` event).
  let ogErrorFallbackReason: FallbackReason | null = null;

  // ── MCP client setup ───────────────────────────────────────────────────────
  const mcpClients: MCPClient[] = [];
  const mcpToolNames = new Set<string>();
  const toolToServer = new Map<string, string>(); // toolName → serverName for event emission
  // Typed as ToolSet (Record<string, Tool>) so the spread contributes an
  // index signature to the tools object; this makes keyof TOOLS = string,
  // which lets prepareStep return { toolChoice: { toolName: string } }.
  const mcpToolsObj: ToolSet = {};
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

  // ── Repair loop state (closure-scoped per turn) ──────────────────────────
  let repairCtx: RepairContext | null = null;
  let repairFailed = false;
  // Tracks the most-recently successfully deployed contract so that a
  // subsequent send_tx_local revert can reference the right source file.
  let lastDeployedMeta: { contractName: string; sourcePath: string } | null = null;

  try {
    const result = streamText({
      // Use .chat() to target /v1/chat/completions (standard SSE format).
      // The default callable routes to the Responses API (/v1/responses) which
      // uses text-start/text-delta/text-end — a format most compatible
      // providers don't implement, causing "text part not found" errors.
      model: openai.chat(config.model),
      system: buildSystemPrompt(files),
      messages: [{ role: 'user', content: prompt }],
      // Allow 40 steps to accommodate up to 3 repair attempts (7 steps each)
      // on top of a normal turn. The `repairFailed` flag provides an early exit.
      stopWhen: [stepCountIs(40), () => repairFailed],
      maxRetries: 1,
      ...(signal ? { abortSignal: signal } : {}),

      // ── prepareStep: steer the model into each repair phase ─────────────
      prepareStep: ({ experimental_context }) => {
        // Merge any context from a prior step back into our closure variable
        // (experimental_context threads RepairContext through the SDK).
        if (experimental_context && typeof experimental_context === 'object') {
          repairCtx = experimental_context as RepairContext;
        }

        if (repairCtx === null || repairCtx.phase === 'idle') {
          // Normal operation — no tool restrictions.
          return {};
        }

        const phaseConfig = REPAIR_PHASE_TOOLS[repairCtx.phase];
        // Double-cast: TypeScript infers TOOLS from the statically-declared
        // tools only (read_file/write_file) because the ToolSet spread from
        // mcpToolsObj is not reflected in generic inference. At runtime,
        // phaseConfig.activeTools and toolName reference valid MCP tool names
        // that are registered in the full tools object via ...mcpToolsObj.
        return {
          activeTools: phaseConfig.activeTools as unknown as Array<'read_file' | 'write_file'>,
          toolChoice: {
            type: 'tool' as const,
            toolName: phaseConfig.toolName as unknown as 'read_file' | 'write_file',
          },
          experimental_context: repairCtx,
        };
      },

      // ── onStepFinish: update repair state and emit typed events ──────────
      onStepFinish: (step) => {
        for (const tc of step.toolCalls ?? []) {
          const rawResult = (
            step.toolResults as Array<{ toolCallId: string; output: unknown }>
          )?.find((r) => r.toolCallId === tc.toolCallId)?.output;

          // ── Phase transitions (inside repair loop) ──────────────────────
          if (repairCtx !== null) {
            switch (tc.toolName) {
              case 'snapshot': {
                const snapshotId = extractSnapshotId(rawResult);
                repairCtx.snapshotId = snapshotId;
                repairCtx.phase = 'trace';
                break;
              }
              case 'trace': {
                // Parse trace from MCP output if possible; emit raw text otherwise.
                const raw = rawResult as
                  | {
                      isError?: boolean;
                      content?: Array<{ type: string; text?: string }>;
                    }
                  | undefined;
                const text = raw?.content?.find((c) => c.type === 'text')?.text ?? '{}';
                let trace: import('@crucible/types').TxTrace;
                try {
                  trace = JSON.parse(text) as import('@crucible/types').TxTrace;
                } catch {
                  trace = {
                    txHash: repairCtx.revertTxHash as import('@crucible/types').Hash,
                    decodedCalls: [],
                    storageReads: [],
                    storageWrites: [],
                    events: [],
                    revertReason: text.slice(0, 500),
                    gasUsed: 0n,
                  };
                }
                emit({ ...baseEvent(), type: 'trace_captured', trace });
                repairCtx.phase = 'recall';
                break;
              }
              case 'recall': {
                const raw = rawResult as
                  | {
                      isError?: boolean;
                      content?: Array<{ type: string; text?: string }>;
                    }
                  | undefined;
                const text = raw?.content?.find((c) => c.type === 'text')?.text ?? '{}';
                let hits: import('@crucible/types').MemoryRecallHit[];
                try {
                  const parsed = JSON.parse(text) as { hits?: unknown[] };
                  hits = (parsed.hits ?? []) as import('@crucible/types').MemoryRecallHit[];
                } catch {
                  hits = [];
                }
                emit({ ...baseEvent(), type: 'memory_recall', hits });
                repairCtx.phase = 'patch';
                break;
              }
              case 'write_file': {
                const args = tc.input as { path?: string; content?: string };
                emit({
                  ...baseEvent(),
                  type: 'patch_proposed',
                  source: 'reasoning',
                  patch: args.content ?? '',
                });
                repairCtx.phase = 'compile';
                break;
              }
              case 'compile': {
                repairCtx.phase = 'revert';
                break;
              }
              case 'revert': {
                repairCtx.phase = 'deploy';
                break;
              }
            }
          }

          // ── Revert detection (from any deploy_local call) ─────────────
          if (tc.toolName === 'deploy_local') {
            const revertInfo = extractDeployRevert('deploy_local', rawResult);
            if (revertInfo.reverted) {
              if (repairCtx === null) {
                // First revert — start repair loop.
                const meta = extractDeployMeta('deploy_local', tc.input);
                repairCtx = {
                  phase: 'snapshot',
                  attempts: 1,
                  revertSignature: revertInfo.revertSignature,
                  revertTxHash: revertInfo.txHash,
                  snapshotId: null,
                  contractName: meta?.contractName ?? '',
                  sourcePath: meta?.sourcePath ?? '',
                };
                emit({
                  ...baseEvent(),
                  type: 'revert_detected',
                  txHash: revertInfo.txHash as import('@crucible/types').Hash,
                  revertSignature: revertInfo.revertSignature,
                });
              } else {
                // Subsequent revert during repair — increment attempt counter.
                repairCtx.attempts += 1;
                if (repairCtx.attempts > 3) {
                  repairFailed = true;
                  emit({
                    ...baseEvent(),
                    type: 'repair_failed',
                    attempts: repairCtx.attempts,
                    lastRevertSignature: revertInfo.revertSignature,
                  });
                  repairCtx = null;
                } else {
                  // Retry — restart repair loop from snapshot phase.
                  repairCtx.phase = 'snapshot';
                  repairCtx.revertSignature = revertInfo.revertSignature;
                  repairCtx.revertTxHash = revertInfo.txHash;
                  repairCtx.snapshotId = null;
                }
              }
            } else if (repairCtx !== null && repairCtx.phase === 'deploy') {
              // Successful redeploy after repair — extract txHash for receipt.
              const raw = rawResult as
                | {
                    isError?: boolean;
                    content?: Array<{ type: string; text?: string }>;
                  }
                | undefined;
              const text = raw?.content?.find((c) => c.type === 'text')?.text ?? '{}';
              let localReceipt: string = '0x' + '0'.repeat(64);
              try {
                const parsed = JSON.parse(text) as { txHash?: string };
                if (parsed.txHash) localReceipt = parsed.txHash;
              } catch {
                // Use default zero hash.
              }
              emit({
                ...baseEvent(),
                type: 'patch_verified',
                localReceipt: localReceipt as import('@crucible/types').Hash,
              });
              // Clear repair state — loop will continue normally.
              repairCtx = null;
            } else {
              // Normal successful deploy (no active repair context) — remember
              // which contract was just deployed in case a following
              // send_tx_local call reverts and triggers the repair loop.
              const meta = extractDeployMeta('deploy_local', tc.input);
              if (meta) lastDeployedMeta = meta;
            }
          }

          // ── Revert detection (from send_tx_local calls) ───────────────
          // deploy_local reverts surface as isError:true; send_tx_local
          // reverts surface as isError:false with status:'reverted' in the
          // JSON body because the tx is mined regardless of outcome.
          if (tc.toolName === 'send_tx_local') {
            const revertInfo = extractSendTxRevert('send_tx_local', rawResult);
            if (revertInfo.reverted) {
              if (repairCtx === null) {
                // First send_tx_local revert — start repair loop.
                repairCtx = {
                  phase: 'snapshot',
                  attempts: 1,
                  revertSignature: revertInfo.revertSignature,
                  revertTxHash: revertInfo.txHash,
                  snapshotId: null,
                  contractName: lastDeployedMeta?.contractName ?? '',
                  sourcePath: lastDeployedMeta?.sourcePath ?? '',
                };
                emit({
                  ...baseEvent(),
                  type: 'revert_detected',
                  txHash: revertInfo.txHash as import('@crucible/types').Hash,
                  revertSignature: revertInfo.revertSignature,
                });
              } else {
                // Subsequent revert during repair — same handling as deploy_local.
                repairCtx.attempts += 1;
                if (repairCtx.attempts > 3) {
                  repairFailed = true;
                  emit({
                    ...baseEvent(),
                    type: 'repair_failed',
                    attempts: repairCtx.attempts,
                    lastRevertSignature: revertInfo.revertSignature,
                  });
                  repairCtx = null;
                } else {
                  repairCtx.phase = 'snapshot';
                  repairCtx.revertSignature = revertInfo.revertSignature;
                  repairCtx.revertTxHash = revertInfo.txHash;
                  repairCtx.snapshotId = null;
                }
              }
            }
          }
        }
      },

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
          if (reason) ogErrorFallbackReason = reason;
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
    // Aborts come back either as native AbortError or with `signal.aborted`
    // already set — surface them as a user-facing cancel notice rather than
    // a generic agent-loop failure, and short-circuit out of the receipt
    // path since cancellation is not an inference outcome.
    const aborted =
      signal?.aborted === true ||
      (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message)));
    if (aborted) {
      emit({ ...baseEvent(), type: 'message', content: '_Cancelled by user._' });
      emit({ ...baseEvent(), type: 'done' });
      return;
    }

    const reason = ogFallbackReasonOf(err);
    if (reason) ogErrorFallbackReason = reason;
    emit({
      ...baseEvent(),
      type: 'error',
      message: `Agent loop failed: ${err instanceof Error ? err.message : String(err)}`,
      ...(reason ? { ogFallbackReason: reason } : {}),
    });
    // Fall through to emit the inference_receipt below so the receipt's
    // fallbackReason field always reflects what happened on this turn.
  } finally {
    // Clean up any dangling chain snapshot if the repair loop was interrupted.
    // We attempt a best-effort revert via the MCP chain server so the local
    // Hardhat node doesn't end up at an unexpected block height after a cancel
    // or unexpected error mid-repair.
    //
    // Type assertion: TypeScript narrows `repairCtx` too aggressively in the
    // finally block because it can't track mutations inside `streamText`
    // callbacks. The declared type is `RepairContext | null`; cast to confirm.
    const finalCtx = repairCtx as RepairContext | null;
    if (finalCtx?.snapshotId != null) {
      const chainUrl = config.mcpServerUrls?.chain;
      if (chainUrl) {
        try {
          const cleanupClient = await createMCPClient({
            transport: {
              type: 'http',
              url: chainUrl,
              ...(config.mcpFetch ? { fetch: config.mcpFetch } : {}),
            },
          });
          const cleanupTools = await cleanupClient.tools({
            schemas: getMcpSchemas('chain'),
          });
          // Call chain.revert to restore state; ignore errors — best-effort only.
          await (
            cleanupTools['revert'] as unknown as {
              execute: (args: { snapshotId: string }, opts?: unknown) => Promise<unknown>;
            }
          )
            ?.execute({ snapshotId: finalCtx.snapshotId })
            .catch(() => undefined);
          await cleanupClient.close().catch(() => undefined);
        } catch {
          // Best-effort — do not rethrow.
        }
      }
    }
    await Promise.all(mcpClients.map((c) => c.close().catch(() => undefined)));
  }

  // Emit inference receipt so the frontend can display cost / provenance.
  // For 0G Compute turns, `attestation` is the JSON-stringified `x_0g_trace`
  // (request_id, provider, billing, and tee_verified when supported) so the
  // UI has the full verifiable receipt — not just the request id.
  const isOg = config.provider === '0g-compute';
  if (isOg && !ogTraceRef.value) {
    console.warn(
      '[agent] 0G Compute turn completed without an x_0g_trace receipt — ' +
        'attestation will be null on this inference receipt.',
    );
  }
  emit({
    ...baseEvent(),
    type: 'inference_receipt',
    receipt: {
      id: InferenceReceiptIdSchema.parse(crypto.randomUUID()),
      provider: config.provider ?? 'openai-compatible',
      model: config.model,
      attestation: isOg && ogTraceRef.value ? JSON.stringify(ogTraceRef.value) : null,
      fallbackReason: isOg ? ogErrorFallbackReason : (config.fallbackReason ?? 'admin_override'),
      promptTokens,
      completionTokens,
      createdAt: Date.now(),
    },
  });

  emit({ ...baseEvent(), type: 'done' });
}
