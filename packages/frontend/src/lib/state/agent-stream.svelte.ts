/**
 * Reactive store for the AgentEvent stream — real client over SSE.
 *
 * Status states track two independent things:
 *   - `connecting` / `idle` / `error` / `closed`: transport state of the SSE
 *     channel itself. `idle` means the connection is open and healthy.
 *   - `streaming`: the agent is actively producing events (mid-turn). Flips
 *     on for any agent-activity event and back to `idle` on
 *     `inference_receipt`, which the agent emits exactly once per turn at
 *     the end of inference.
 *
 * Implementation note: we deliberately do NOT use the browser's
 * `EventSource` API. Firefox aborts EventSource connections that exist
 * during navigation/HMR and logs a noisy "connection interrupted while the
 * page was loading" warning every time. `fetch` + `ReadableStream` gives us
 * the same SSE wire format with cleaner abort semantics and no console
 * spam.
 *
 * Pattern: factory class + Svelte context. Each layout instance creates its
 * own `AgentStream`, so SSR requests don't leak state into each other.
 */

import { getContext, setContext } from 'svelte';
import { AgentEventSchema, type AgentEvent } from '@crucible/types';
import { apiClient } from '$lib/api/workspace';

export type AgentStreamStatus = 'idle' | 'connecting' | 'streaming' | 'error' | 'closed';

export interface AgentStreamOptions {
	/**
	 * Override `fetch` for testing. Defaults to `globalThis.fetch`.
	 */
	fetchImpl?: typeof fetch;
}

export class AgentStream {
	events = $state<AgentEvent[]>([]);
	status = $state<AgentStreamStatus>('idle');
	error = $state<string | null>(null);

	private readonly fetchImpl: typeof fetch;
	private controller: AbortController | null = null;
	// Increments on every start/stop. The async pump uses this to bail out if
	// the caller cancelled while we were mid-await.
	private startToken = 0;

	constructor(opts: AgentStreamOptions = {}) {
		this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
	}

	/** Open the SSE connection for a given workspace. Idempotent. */
	start(workspaceId: string): void {
		if (this.controller) return;
		const token = ++this.startToken;
		this.status = 'connecting';
		this.events = [];
		this.error = null;

		const controller = new AbortController();
		this.controller = controller;

		void this.pump(workspaceId, token, controller.signal);
	}

	/** Close the SSE connection. */
	stop(): void {
		this.startToken += 1;
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
		this.status = 'closed';
	}

	private async pump(workspaceId: string, token: number, signal: AbortSignal): Promise<void> {
		try {
			const url = apiClient.api.agent.stream.$url({ query: { workspaceId } });
			const response = await this.fetchImpl(url.toString(), {
				signal,
				credentials: 'include',
				headers: { Accept: 'text/event-stream' }
			});

			if (token !== this.startToken) return;
			if (!response.ok || !response.body) {
				this.status = 'error';
				this.error = `Agent stream HTTP ${response.status}`;
				return;
			}

			this.status = 'idle';

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (token !== this.startToken) return;
				buffer += decoder.decode(value, { stream: true });

				// SSE frames are separated by a blank line. Each frame is one or
				// more `field: value` lines. We only care about `data:` payloads.
				let sep: number;
				while ((sep = buffer.indexOf('\n\n')) >= 0) {
					const frame = buffer.slice(0, sep);
					buffer = buffer.slice(sep + 2);
					this.handleFrame(parseSseData(frame));
				}
			}

			// Server closed the stream cleanly.
			if (token === this.startToken) this.status = 'closed';
		} catch (err) {
			// AbortError is the normal stop() path — not an error.
			if (signal.aborted) return;
			if (token !== this.startToken) return;
			this.status = 'error';
			this.error = err instanceof Error ? err.message : 'Failed to read agent stream';
		}
	}

	private handleFrame(data: string | null): void {
		if (data === null) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			this.status = 'error';
			this.error = 'Received malformed agent event (invalid JSON)';
			return;
		}
		const result = AgentEventSchema.safeParse(parsed);
		if (!result.success) {
			this.status = 'error';
			this.error = `Agent event failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`;
			return;
		}
		const incoming = result.data;

		// Drive the streaming/idle flag from event types. `inference_receipt`
		// marks the end of a turn; anything else mid-turn means the agent is
		// still producing.
		if (this.status !== 'error' && this.status !== 'closed') {
			this.status = incoming.type === 'inference_receipt' ? 'idle' : 'streaming';
		}

		// Accumulate consecutive thinking deltas into a single event so the chat
		// rail renders one collapsible block instead of one row per token.
		if (incoming.type === 'thinking' && this.events.length > 0) {
			const last = this.events[this.events.length - 1];
			if (last?.type === 'thinking' && last.streamId === incoming.streamId) {
				this.events[this.events.length - 1] = { ...last, text: last.text + incoming.text };
				return;
			}
		}
		// Convert streaming message_delta tokens into a single accumulated
		// `message` event so the chat rail renders one row that grows in place.
		if (incoming.type === 'message_delta') {
			const last = this.events.length > 0 ? this.events[this.events.length - 1] : undefined;
			if (last?.type === 'message' && last.streamId === incoming.streamId) {
				this.events[this.events.length - 1] = {
					...last,
					content: last.content + incoming.text
				};
			} else {
				this.events.push({
					type: 'message',
					streamId: incoming.streamId,
					seq: incoming.seq,
					emittedAt: incoming.emittedAt,
					content: incoming.text
				});
			}
			return;
		}
		this.events.push(incoming);
	}
}

/**
 * Pull the joined `data:` payload out of one SSE frame. Returns `null` for
 * comment-only frames (which start with `:`).
 */
function parseSseData(frame: string): string | null {
	const lines = frame.split('\n');
	const dataParts: string[] = [];
	for (const line of lines) {
		if (line.startsWith('data:')) {
			dataParts.push(line.slice(line[5] === ' ' ? 6 : 5));
		}
	}
	return dataParts.length > 0 ? dataParts.join('\n') : null;
}

const KEY = Symbol('crucible.agent-stream');

export function setAgentStream(stream: AgentStream): void {
	setContext(KEY, stream);
}

export function getAgentStream(): AgentStream {
	const stream = getContext<AgentStream | undefined>(KEY);
	if (!stream) {
		throw new Error('getAgentStream() called without setAgentStream() in an ancestor.');
	}
	return stream;
}
