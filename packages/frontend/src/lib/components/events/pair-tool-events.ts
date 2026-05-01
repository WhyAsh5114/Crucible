import type { AgentEvent } from '@crucible/types';

type ToolCallEvent = Extract<AgentEvent, { type: 'tool_call' }>;
type ToolResultEvent = Extract<AgentEvent, { type: 'tool_result' }>;

export type ChatEvent = Exclude<AgentEvent, { type: 'tool_call' | 'tool_result' }>;

export type ChatItem =
	| {
			kind: 'event';
			event: ChatEvent;
			key: string;
			/**
			 * Number of consecutive identical events that were folded into this
			 * item. `1` means a single occurrence. Currently used to dedupe
			 * spammy `error` events emitted on every retry of a failing
			 * inference call so the chat rail doesn't fill with N copies of the
			 * same row.
			 */
			repeatCount: number;
	  }
	| { kind: 'tool'; call: ToolCallEvent; result: ToolResultEvent | null; key: string };

export function pairToolEvents(events: readonly AgentEvent[]): ChatItem[] {
	const resultsByCallId = new Map<string, ToolResultEvent>();
	for (const event of events) {
		if (event.type === 'tool_result') {
			resultsByCallId.set(event.callId, event);
		}
	}

	const items: ChatItem[] = [];
	for (const event of events) {
		if (event.type === 'tool_call') {
			items.push({
				kind: 'tool',
				call: event,
				result: resultsByCallId.get(event.callId) ?? null,
				key: `${event.streamId}:${event.callId}`
			});
			continue;
		}
		if (event.type === 'tool_result') {
			// Paired in the tool_call branch above (or orphan — drop silently;
			// a result without its preceding call is a control-plane bug, not UX).
			continue;
		}

		// Fold consecutive identical errors into a single row. "Identical" means
		// same `type` AND same human message — providers that return malformed
		// shapes hit `streamText`'s retry loop and emit the same ZodError on
		// every attempt, producing N near-duplicate rows that bury everything
		// else in the rail.
		const previous = items[items.length - 1];
		if (
			event.type === 'error' &&
			previous?.kind === 'event' &&
			previous.event.type === 'error' &&
			previous.event.message === event.message
		) {
			previous.repeatCount += 1;
			previous.event = event; // keep the latest seq/emittedAt for the timestamp
			previous.key = `${event.streamId}:${previous.repeatCount}-from-${previous.key}`;
			continue;
		}

		items.push({
			kind: 'event',
			event,
			// Including `emittedAt` makes the key tolerant of seq collisions —
			// e.g. a backend hot-reload that resets the seq counter mid-session
			// would otherwise crash Svelte's keyed-each. The seq itself stays
			// in the key so legitimately distinct events still get distinct
			// keys even when emitted within the same millisecond.
			key: `${event.streamId}:${event.seq}:${event.emittedAt}`,
			repeatCount: 1
		});
	}
	return items;
}
