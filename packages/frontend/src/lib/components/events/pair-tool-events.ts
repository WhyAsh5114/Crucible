import type { AgentEvent } from '@crucible/types';

type ToolCallEvent = Extract<AgentEvent, { type: 'tool_call' }>;
type ToolResultEvent = Extract<AgentEvent, { type: 'tool_result' }>;

export type ChatEvent = Exclude<AgentEvent, { type: 'tool_call' | 'tool_result' }>;

export type ChatItem =
	| { kind: 'event'; event: ChatEvent; key: string }
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
		} else if (event.type === 'tool_result') {
			// Paired in the tool_call branch above (or orphan — drop silently;
			// a result without its preceding call is a control-plane bug, not UX).
			continue;
		} else {
			items.push({ kind: 'event', event, key: `${event.streamId}:${event.seq}` });
		}
	}
	return items;
}
