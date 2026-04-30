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
import { apiClient, workspaceClient } from '$lib/api/workspace';

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
	// Tracks the open coalescing buffers for the current turn. Reset to -1 at
	// turn boundaries (`inference_receipt` / `done`) and on `start()` /
	// `hydrate()` so a new turn never appends to a historical event.
	private openMessageIndex = -1;
	private openThinkingIndex = -1;
	// Guard against duplicate hydration: the second call replaces `events`
	// with a fresh fetch but we don't want to issue redundant requests when
	// callers re-mount.
	private hydratePromise: Promise<void> | null = null;

	constructor(opts: AgentStreamOptions = {}) {
		this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
	}

	/**
	 * Fetch persisted chat history for a workspace and seed `events`. Safe to
	 * call before `start()`. Idempotent — concurrent calls share one in-flight
	 * request, and a completed hydrate replaces `events` with the latest
	 * server snapshot rather than appending. Never throws: a transport failure
	 * is logged and `events` is left untouched so the live SSE can still drive
	 * the UI.
	 */
	hydrate(workspaceId: string): Promise<void> {
		if (this.hydratePromise) return this.hydratePromise;
		const promise = (async () => {
			try {
				const history = await workspaceClient.getChatHistory(workspaceId);
				this.events = history;
				this.openMessageIndex = -1;
				this.openThinkingIndex = -1;
			} catch (err) {
				console.warn('[agent-stream] hydrate failed; continuing without history', err);
			} finally {
				this.hydratePromise = null;
			}
		})();
		this.hydratePromise = promise;
		return promise;
	}

	/** Reset the store back to its initial empty state. */
	clear(): void {
		this.events = [];
		this.openMessageIndex = -1;
		this.openThinkingIndex = -1;
		this.error = null;
	}

	/** Open the SSE connection for a given workspace. Idempotent. */
	start(workspaceId: string): void {
		if (this.controller) return;
		const token = ++this.startToken;
		this.status = 'connecting';
		this.error = null;
		// A new live stream starts fresh — any open buffers from a prior turn
		// or from hydrated history must not be appended to.
		this.openMessageIndex = -1;
		this.openThinkingIndex = -1;

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
		// rail renders one collapsible block instead of one row per token. We
		// rely on an explicit open-buffer index — never "the last event" —
		// because hydrated history events sit at the end of `events` until the
		// first turn boundary clears them, and we must not append a new turn's
		// deltas onto a historical row.
		if (incoming.type === 'thinking') {
			const open = this.openThinkingIndex >= 0 ? this.events[this.openThinkingIndex] : undefined;
			if (open?.type === 'thinking' && open.streamId === incoming.streamId) {
				this.events[this.openThinkingIndex] = {
					...open,
					text: open.text + incoming.text
				};
			} else {
				this.events.push(incoming);
				this.openThinkingIndex = this.events.length - 1;
			}
			return;
		}
		// Convert streaming message_delta tokens into a single accumulated
		// `message` event so the chat rail renders one row that grows in place.
		if (incoming.type === 'message_delta') {
			const open = this.openMessageIndex >= 0 ? this.events[this.openMessageIndex] : undefined;
			if (open?.type === 'message' && open.streamId === incoming.streamId) {
				this.events[this.openMessageIndex] = {
					...open,
					content: open.content + incoming.text
				};
			} else {
				this.events.push({
					type: 'message',
					streamId: incoming.streamId,
					seq: incoming.seq,
					emittedAt: incoming.emittedAt,
					content: incoming.text
				});
				this.openMessageIndex = this.events.length - 1;
			}
			return;
		}
		// Turn boundaries close any open buffers so the next turn's first
		// delta starts a fresh row.
		if (incoming.type === 'inference_receipt' || incoming.type === 'done') {
			this.openMessageIndex = -1;
			this.openThinkingIndex = -1;
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
