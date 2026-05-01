import { z } from 'zod';

import { TimestampMsSchema } from './primitives.ts';

export const DevtoolsEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool_call'),
    ts: TimestampMsSchema,
    server: z.string().min(1),
    tool: z.string().min(1),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    ts: TimestampMsSchema,
    server: z.string().min(1),
    tool: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown(),
    durationMs: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal('container'),
    ts: TimestampMsSchema,
    subtype: z.string().min(1),
    message: z.string(),
  }),
]);

export type DevtoolsEvent = z.infer<typeof DevtoolsEventSchema>;

const DEFAULT_DEVTOOLS_URL = 'http://127.0.0.1:3107/event';

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export function createDevtoolsReporter(server: string) {
  const endpoint = process.env['DEVTOOLS_EVENT_URL'] ?? DEFAULT_DEVTOOLS_URL;

  const post = async (event: DevtoolsEvent): Promise<void> => {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: withTimeout(750),
      });
    } catch {
      // Devtools must never affect MCP execution paths.
    }
  };

  return {
    async emitToolCall(tool: string, args: unknown): Promise<void> {
      await post({ type: 'tool_call', ts: Date.now(), server, tool, args });
    },
    async emitToolResult(
      tool: string,
      ok: boolean,
      result: unknown,
      durationMs: number,
    ): Promise<void> {
      await post({
        type: 'tool_result',
        ts: Date.now(),
        server,
        tool,
        ok,
        result,
        durationMs,
      });
    },
    async emitContainer(subtype: string, message: string): Promise<void> {
      await post({ type: 'container', ts: Date.now(), subtype, message });
    },
  };
}
