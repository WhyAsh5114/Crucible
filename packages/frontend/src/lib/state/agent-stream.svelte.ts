/**
 * Reactive store for the AgentEvent stream. Phase 0/1 only supports fixture
 * replay; the real `wss://.../ws/agent` path lands when the backend is up.
 *
 * Pattern: factory class + Svelte context. Each layout instance creates its
 * own `AgentStream`, so SSR requests don't leak state into each other.
 */

import { getContext, setContext } from 'svelte';
import type { AgentEvent } from '@crucible/types';
import { fixtureAgentEvents } from '$lib/fixtures/agent-events';

export type AgentStreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export type AgentStreamMode = 'fixture' | 'live' | 'disabled';

export interface AgentStreamOptions {
	/** Source of events. `fixture` replays canned data; `live` would attach a
	 *  WebSocket (not yet implemented). `disabled` produces no events. */
	mode: AgentStreamMode;
	/** Milliseconds between fixture frames. Lower = snappier demos. */
	fixtureCadenceMs?: number;
}

export class AgentStream {
	events = $state<AgentEvent[]>([]);
	status = $state<AgentStreamStatus>('idle');
	error = $state<string | null>(null);

	readonly mode: AgentStreamMode;
	private readonly cadenceMs: number;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(opts: AgentStreamOptions) {
		this.mode = opts.mode;
		this.cadenceMs = opts.fixtureCadenceMs ?? 600;
	}

	start(): void {
		if (this.status === 'streaming' || this.status === 'done') return;
		this.events = [];
		this.error = null;

		if (this.mode === 'fixture') {
			this.replayFixtures();
			return;
		}
		if (this.mode === 'live') {
			this.error = 'Live agent stream not yet wired (Phase 0/1 stub).';
			this.status = 'error';
			return;
		}
		this.status = 'idle';
	}

	stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private replayFixtures(): void {
		this.status = 'streaming';
		let i = 0;
		const tick = (): void => {
			if (i >= fixtureAgentEvents.length) {
				this.status = 'done';
				this.timer = null;
				return;
			}
			const next = fixtureAgentEvents[i];
			if (next) this.events.push(next);
			i += 1;
			this.timer = setTimeout(tick, this.cadenceMs);
		};
		this.timer = setTimeout(tick, this.cadenceMs);
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
