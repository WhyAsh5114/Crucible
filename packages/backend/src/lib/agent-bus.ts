/**
 * In-process pub/sub for `AgentEvent`s, scoped per workspace.
 *
 * Producers (the runtime tool-exec proxy, future MCP wrappers, future
 * inference router) call `publish(workspaceId, event)`. Consumers (the SSE
 * endpoint at `/api/agent/stream`) call `subscribe(workspaceId)` to obtain
 * an async iterator of validated `AgentEvent`s.
 *
 * This is a real bus: no fixtures, no echoes. If nothing produces, nothing
 * flows — which is the honest state of Phase 0/1 until the agent loop and
 * MCP wrappers are wired up.
 *
 * Single-process only. A multi-instance backend will need to swap this for
 * Redis pub/sub or a Postgres LISTEN/NOTIFY adapter behind the same API.
 */

import { AgentEventSchema, type AgentEvent } from '@crucible/types';
import { recordChatEvent, readChatHistory } from './chat-log';

type Subscriber = (event: AgentEvent) => void;

// All maps below are keyed by `${workspaceId}:${sessionId}`.
const subscribers = new Map<string, Set<Subscriber>>();
const sequence = new Map<string, number>();
const warmed = new Set<string>();

function busKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

/**
 * Initialise the in-memory sequence counter for `workspaceId` from the
 * persisted chat log so a backend hot-reload doesn't reset it back to 0.
 * Without this, `nextAgentSeq` would emit seq 0..N again after a restart,
 * producing duplicate seqs in chat.jsonl and `each_key_duplicate` Svelte
 * crashes once the frontend hydrates the old log alongside the new turn.
 *
 * Idempotent — only the first call per (workspace, session) per process
 * actually reads the log; subsequent calls are a Set lookup.
 */
export async function warmAgentSeq(workspaceId: string, sessionId: string): Promise<void> {
  const key = busKey(workspaceId, sessionId);
  if (warmed.has(key)) return;
  warmed.add(key);
  try {
    const events = await readChatHistory(workspaceId, sessionId);
    if (events.length === 0) return;
    let max = 0;
    for (const ev of events) {
      if (ev.seq > max) max = ev.seq;
    }
    // Only bump the counter if the on-disk log is ahead of the in-memory
    // state — never roll back a counter that was already advanced this run.
    const current = sequence.get(key) ?? 0;
    if (max + 1 > current) sequence.set(key, max + 1);
  } catch {
    // First-time workspaces have no log; nothing to warm from.
  }
}

/**
 * Allocate the next monotonic `seq` for the given workspace + session stream.
 */
export function nextAgentSeq(workspaceId: string, sessionId: string): number {
  const key = busKey(workspaceId, sessionId);
  const current = sequence.get(key) ?? 0;
  sequence.set(key, current + 1);
  return current;
}

/**
 * Publish an `AgentEvent` to all subscribers of `workspaceId` + `sessionId`.
 */
export function publishAgentEvent(workspaceId: string, sessionId: string, event: AgentEvent): void {
  const validated = AgentEventSchema.parse(event);

  // Persist before fan-out so the on-disk chat log captures every event
  // regardless of whether anyone is currently subscribed.
  recordChatEvent(workspaceId, sessionId, validated);

  const key = busKey(workspaceId, sessionId);
  const set = subscribers.get(key);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(validated);
    } catch {
      // A misbehaving subscriber must not break sibling subscribers.
    }
  }
}

/**
 * Subscribe to a workspace session's event stream. Returns an async iterator
 * that yields each event in publish order, plus an `unsubscribe` method to detach.
 */
export function subscribeAgentEvents(
  workspaceId: string,
  sessionId: string,
): {
  events: AsyncIterable<AgentEvent>;
  unsubscribe: () => void;
} {
  const key = busKey(workspaceId, sessionId);
  const queue: AgentEvent[] = [];
  let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
  let closed = false;

  const handler: Subscriber = (event) => {
    if (closed) return;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: event, done: false });
    } else {
      queue.push(event);
    }
  };

  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(handler);

  const unsubscribe = (): void => {
    if (closed) return;
    closed = true;
    const s = subscribers.get(key);
    s?.delete(handler);
    if (s && s.size === 0) subscribers.delete(key);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as unknown as AgentEvent, done: true });
    }
  };

  const events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      return {
        next(): Promise<IteratorResult<AgentEvent>> {
          if (queue.length > 0) {
            const value = queue.shift() as AgentEvent;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as AgentEvent, done: true });
          }
          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },
        return(): Promise<IteratorResult<AgentEvent>> {
          unsubscribe();
          return Promise.resolve({ value: undefined as unknown as AgentEvent, done: true });
        },
      };
    },
  };

  return { events, unsubscribe };
}

/**
 * Remove all in-memory bus state for the given workspace. Call this when a
 * workspace is closed or deleted so subscribers and sequence counters do not
 * accumulate indefinitely.
 */
export function cleanupAgentBus(workspaceId: string): void {
  subscribers.delete(workspaceId);
  sequence.delete(workspaceId);
}
