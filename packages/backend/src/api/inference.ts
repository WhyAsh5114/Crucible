/**
 * Inference router — `POST /api/prompt`.
 *
 * Accepts a user prompt, calls an OpenAI-compatible Chat Completions endpoint
 * (env-configured base URL + API key + model), streams the model's tokens back
 * over the workspace's agent event bus as `thinking` deltas, and emits a final
 * `message` + `inference_receipt` + `done` event.
 *
 * The HTTP response itself is small and synchronous: it returns a `streamId`
 * (the workspace id) and kicks the streaming work off in the background. The
 * frontend reads tokens from the existing `/api/agent/stream` SSE feed.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  PromptRequestSchema,
  PromptResponseSchema,
  StreamIdSchema,
  InferenceReceiptIdSchema,
} from '@crucible/types';
import { prisma } from '../lib/prisma';
import { createApiErrorBody } from '../lib/api-error';
import { nextAgentSeq, publishAgentEvent } from '../lib/agent-bus';

// ── OpenAI-compatible client config (env-driven) ─────────────────────────────

function readInferenceConfig():
  | { ok: true; baseUrl: string; apiKey: string; model: string }
  | { ok: false; reason: string } {
  const baseUrl = process.env['OPENAI_BASE_URL'];
  const apiKey = process.env['OPENAI_API_KEY'];
  const model = process.env['OPENAI_MODEL'];
  if (!baseUrl) return { ok: false, reason: 'OPENAI_BASE_URL is not set' };
  if (!apiKey) return { ok: false, reason: 'OPENAI_API_KEY is not set' };
  if (!model) return { ok: false, reason: 'OPENAI_MODEL is not set' };
  // Strip trailing slash so we can append /chat/completions.
  return { ok: true, baseUrl: baseUrl.replace(/\/+$/u, ''), apiKey, model };
}

const SYSTEM_PROMPT =
  'You are Crucible, an in-browser agent IDE for solidity smart contracts. ' +
  'You help the user write, compile, and ship Solidity. Be concise. Use code ' +
  'fences for any code. Do not invent tool calls — tool wiring is provided ' +
  'separately by the runtime.';

// ── OpenAPI route definition ─────────────────────────────────────────────────

const promptRoute = createRoute({
  method: 'post',
  path: '/prompt',
  request: {
    body: {
      content: { 'application/json': { schema: PromptRequestSchema } },
      required: true,
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: PromptResponseSchema } },
      description: 'Inference accepted; subscribe to /api/agent/stream',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace not found',
    },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Inference provider unavailable',
    },
  },
});

// ── Streaming helpers ────────────────────────────────────────────────────────

interface OpenAIDelta {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Parse an OpenAI-style SSE stream into delta tokens + a final usage block. */
async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; promptTokens: number; completionTokens: number }
> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: { promptTokens: number; completionTokens: number } | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd: number;
    while ((lineEnd = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!rawLine.startsWith('data:')) continue;
      const payload = rawLine.slice(5).trim();
      if (payload === '[DONE]') continue;

      let chunk: OpenAIDelta;
      try {
        chunk = JSON.parse(payload) as OpenAIDelta;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        yield { kind: 'delta', text: delta };
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }
  }

  if (usage) yield { kind: 'usage', ...usage };
}

/** Fire-and-forget streaming run — publishes events to the agent bus. */
async function runInference(workspaceId: string, prompt: string): Promise<void> {
  const cfg = readInferenceConfig();
  const streamId = StreamIdSchema.parse(workspaceId);

  // The base every emitted event needs. Sequence numbers come from the bus
  // helper so they stay monotonic across all event sources.
  const baseEvent = (): { streamId: typeof streamId; seq: number; emittedAt: number } => ({
    streamId,
    seq: nextAgentSeq(workspaceId),
    emittedAt: Date.now(),
  });

  if (!cfg.ok) {
    publishAgentEvent(workspaceId, {
      ...baseEvent(),
      type: 'error',
      message: `Inference unavailable: ${cfg.reason}`,
    });
    publishAgentEvent(workspaceId, { ...baseEvent(), type: 'done' });
    return;
  }

  // Echo the user's prompt back as a `message` so the chat rail shows it
  // alongside the assistant's response.
  publishAgentEvent(workspaceId, {
    ...baseEvent(),
    type: 'message',
    content: `**you:** ${prompt}`,
  });

  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        // Many OpenAI-compatible providers honour `stream_options.include_usage`
        // to emit a final usage block. Harmless when ignored.
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });
  } catch (err) {
    publishAgentEvent(workspaceId, {
      ...baseEvent(),
      type: 'error',
      message: `Inference request failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    publishAgentEvent(workspaceId, { ...baseEvent(), type: 'done' });
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    publishAgentEvent(workspaceId, {
      ...baseEvent(),
      type: 'error',
      message: `Inference HTTP ${response.status}: ${text.slice(0, 500)}`,
    });
    publishAgentEvent(workspaceId, { ...baseEvent(), type: 'done' });
    return;
  }

  let full = '';
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for await (const chunk of parseOpenAIStream(response.body as ReadableStream<Uint8Array>)) {
      if (chunk.kind === 'delta') {
        full += chunk.text;
        // Emit each delta as a `thinking` frame so the chat rail can stream
        // tokens. The final consolidated reply is emitted as `message` below.
        publishAgentEvent(workspaceId, {
          ...baseEvent(),
          type: 'thinking',
          text: chunk.text,
        });
      } else {
        promptTokens = chunk.promptTokens;
        completionTokens = chunk.completionTokens;
      }
    }
  } catch (err) {
    publishAgentEvent(workspaceId, {
      ...baseEvent(),
      type: 'error',
      message: `Inference stream broke: ${err instanceof Error ? err.message : String(err)}`,
    });
    publishAgentEvent(workspaceId, { ...baseEvent(), type: 'done' });
    return;
  }

  if (full.length > 0) {
    publishAgentEvent(workspaceId, {
      ...baseEvent(),
      type: 'message',
      content: full,
    });
  }

  publishAgentEvent(workspaceId, {
    ...baseEvent(),
    type: 'inference_receipt',
    receipt: {
      id: InferenceReceiptIdSchema.parse(randomUUID()),
      provider: 'openai-compatible',
      model: cfg.model,
      attestation: null,
      // Until 0G is wired, every fallback call is admin_override.
      fallbackReason: 'admin_override',
      promptTokens,
      completionTokens,
      createdAt: Date.now(),
    },
  });
  publishAgentEvent(workspaceId, { ...baseEvent(), type: 'done' });
}

// ── Router ───────────────────────────────────────────────────────────────────

export const inferenceApi = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        createApiErrorBody('bad_request', result.error.issues[0]?.message ?? 'Validation failed'),
        400,
      );
    }
    return undefined;
  },
}).openapi(promptRoute, async (c) => {
  const { workspaceId, prompt } = c.req.valid('json');

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  // Kick off in the background; the caller is expected to be subscribed to
  // /api/agent/stream already.
  void runInference(workspaceId, prompt);

  return c.json(PromptResponseSchema.parse({ streamId: StreamIdSchema.parse(workspaceId) }), 202);
});
