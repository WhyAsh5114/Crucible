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
import { recordChatEvent } from './chat-log';

type Subscriber = (event: AgentEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const sequence = new Map<string, number>();

/**
 * Allocate the next monotonic `seq` for the given workspace's stream. Used
 * by producers to stamp `AgentEvent`s before publishing.
 */
export function nextAgentSeq(workspaceId: string): number {
  const current = sequence.get(workspaceId) ?? 0;
  sequence.set(workspaceId, current + 1);
  return current;
}

/**
 * Publish an `AgentEvent` to all subscribers of `workspaceId`. Validates
 * the event against the schema so producers can't smuggle malformed frames
 * through the bus.
 */
export function publishAgentEvent(workspaceId: string, event: AgentEvent): void {
  const validated = AgentEventSchema.parse(event);

  // Persist before fan-out so the on-disk chat log captures every event
  // regardless of whether anyone is currently subscribed (e.g. user reloaded
  // mid-turn — we still want the rest of the turn in history).
  recordChatEvent(workspaceId, validated);

  const set = subscribers.get(workspaceId);
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
 * Subscribe to a workspace's event stream. Returns an async iterator that
 * yields each event in publish order, plus an `unsubscribe` method to detach.
 *
 * The iterator never completes on its own — callers must call `unsubscribe()`
 * when their consumer (e.g. an SSE connection) closes.
 */
export function subscribeAgentEvents(workspaceId: string): {
  events: AsyncIterable<AgentEvent>;
  unsubscribe: () => void;
} {
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

  let set = subscribers.get(workspaceId);
  if (!set) {
    set = new Set();
    subscribers.set(workspaceId, set);
  }
  set.add(handler);

  const unsubscribe = (): void => {
    if (closed) return;
    closed = true;
    const s = subscribers.get(workspaceId);
    s?.delete(handler);
    if (s && s.size === 0) subscribers.delete(workspaceId);
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
