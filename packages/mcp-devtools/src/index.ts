import { Hono } from 'hono';

type DevtoolsEvent =
  | { type: 'tool_call'; ts: number; server: string; tool: string; args: unknown }
  | {
      type: 'tool_result';
      ts: number;
      server: string;
      tool: string;
      ok: boolean;
      result: unknown;
      durationMs: number;
    }
  | { type: 'container'; ts: number; subtype: string; message: string };

const PORT = process.env['DEVTOOLS_MCP_PORT']
  ? Number.parseInt(process.env['DEVTOOLS_MCP_PORT'], 10)
  : 3107;
const MAX_EVENTS = 500;
const buffer: DevtoolsEvent[] = [];
const subscribers = new Set<(event: DevtoolsEvent) => void>();

function appendEvent(event: DevtoolsEvent): void {
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) {
    buffer.splice(0, buffer.length - MAX_EVENTS);
  }
  for (const notify of subscribers) {
    try {
      notify(event);
    } catch {
      // Individual subscriber failures are isolated.
    }
  }
}

function isDevtoolsEvent(value: unknown): value is DevtoolsEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (typeof event['type'] !== 'string' || typeof event['ts'] !== 'number') return false;
  if (event['type'] === 'tool_call') {
    return typeof event['server'] === 'string' && typeof event['tool'] === 'string';
  }
  if (event['type'] === 'tool_result') {
    return (
      typeof event['server'] === 'string' &&
      typeof event['tool'] === 'string' &&
      typeof event['ok'] === 'boolean' &&
      typeof event['durationMs'] === 'number'
    );
  }
  if (event['type'] === 'container') {
    return typeof event['subtype'] === 'string' && typeof event['message'] === 'string';
  }
  return false;
}

const app = new Hono();

app.post('/event', async (c) => {
  try {
    const payload = await c.req.json<unknown>();

    if (isDevtoolsEvent(payload)) {
      appendEvent(payload);
    }
  } catch {
    // Must never throw from this endpoint.
  }
  return c.json({ ok: true });
});

app.get('/events', (c) => {
  const encoder = new TextEncoder();
  const snapshot = [...buffer];

  const body = new ReadableStream({
    start(controller) {
      const write = (event: DevtoolsEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected.
        }
      };

      for (const event of snapshot) {
        write(event);
      }

      const listener = (event: DevtoolsEvent) => write(event);
      subscribers.add(listener);

      c.req.raw.signal.addEventListener('abort', () => {
        subscribers.delete(listener);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      // Cancellation cleanup is handled via abort signal listener.
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

console.log(`[mcp-devtools] starting on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
