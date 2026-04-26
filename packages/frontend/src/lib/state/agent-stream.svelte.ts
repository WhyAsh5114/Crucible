/**
 * Reactive store for the AgentEvent stream — real client over SSE.
 *
 * Backend exposes `GET /api/agent/stream?workspaceId=<id>` as a
 * `text/event-stream`. Each frame is a Zod-validated `AgentEvent` from
 * `@crucible/types`. There is no fixture or fallback path: the stream is
 * either connected and silent, connected and producing real events, or
 * errored. The chat rail surfaces whichever state is current.
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
	 * Factory for the underlying `EventSource`. Defaults to the global
	 * constructor. Tests can inject a fake to drive deterministic frames.
	 */
	eventSourceFactory?: (url: string) => EventSource;
}

export class AgentStream {
	events = $state<AgentEvent[]>([]);
	status = $state<AgentStreamStatus>('idle');
	error = $state<string | null>(null);

	private readonly factory: (url: string) => EventSource;
	private source: EventSource | null = null;

	constructor(opts: AgentStreamOptions = {}) {
		this.factory =
			opts.eventSourceFactory ?? ((url) => new EventSource(url, { withCredentials: true }));
	}

	/** Open the SSE connection for a given workspace. Idempotent. */
	start(workspaceId: string): void {
		if (this.source) return;
		this.events = [];
		this.error = null;
		this.status = 'connecting';

		// Hono RPC builds the URL from the typed route definition.
		const url = apiClient.api.agent.stream.$url({ query: { workspaceId } });
		const source = this.factory(url.toString());

		source.onopen = () => {
			this.status = 'streaming';
		};
		source.onmessage = (msg) => this.handleFrame(msg.data);
		source.onerror = () => {
			// EventSource auto-retries on transient failures; only surface an
			// error when the connection is irrecoverable.
			if (source.readyState === source.CLOSED) {
				this.status = 'error';
				this.error = 'Agent stream connection closed';
			}
		};

		this.source = source;
	}

	/** Close the SSE connection. */
	stop(): void {
		if (this.source) {
			this.source.close();
			this.source = null;
		}
		this.status = 'closed';
	}

	private handleFrame(data: unknown): void {
		if (typeof data !== 'string') return;
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
		this.events.push(result.data);
	}
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
