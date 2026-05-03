import { getContext, setContext } from 'svelte';

import { DevtoolsEventSchema, type DevtoolsEvent } from '@crucible/types';
import { apiClient } from '$lib/api/workspace';

export type DevtoolsStreamStatus =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'cutoff'
	| 'error'
	| 'closed'
	| 'reconnecting';

export class DevtoolsStream {
	events = $state<DevtoolsEvent[]>([]);
	status = $state<DevtoolsStreamStatus>('idle');
	error = $state<string | null>(null);

	private readonly fetchImpl: typeof fetch;
	private controller: AbortController | null = null;
	private startToken = 0;
	private workspaceId: string | null = null;
	private sawEvent = false;

	constructor(opts: { fetchImpl?: typeof fetch } = {}) {
		this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
	}

	start(workspaceId: string, opts: { resetEvents?: boolean } = {}): void {
		const resetEvents = opts.resetEvents ?? true;
		// Only skip if already connecting/connected to the same workspace
		if (
			this.controller &&
			!this.controller.signal.aborted &&
			this.workspaceId === workspaceId &&
			(this.status === 'connecting' || this.status === 'connected')
		) {
			return;
		}
		this.disconnect();
		this.workspaceId = workspaceId;
		if (resetEvents) this.events = [];
		this.status = 'connecting';
		this.error = null;
		this.sawEvent = false;

		const controller = new AbortController();
		this.controller = controller;
		void this.pump(workspaceId, ++this.startToken, controller.signal);
	}

	retry(): void {
		if (!this.workspaceId) return;
		this.start(this.workspaceId, { resetEvents: false });
	}

	clear(): void {
		this.events = [];
	}

	stop(): void {
		this.disconnect();
		this.status = 'closed';
	}

	private disconnect(): void {
		this.startToken += 1;
		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
	}

	private async pump(workspaceId: string, token: number, signal: AbortSignal): Promise<void> {
		let retryCount = 0;

		while (token === this.startToken && !signal.aborted) {
			try {
				const url = apiClient.api.workspace[':id'].devtools.events.$url({
					param: { id: workspaceId }
				});
				const response = await this.fetchImpl(url.toString(), {
					signal,
					credentials: 'include',
					headers: { Accept: 'text/event-stream' }
				});

				if (token !== this.startToken) return;
				if (!response.ok || !response.body) {
					this.status = 'error';
					this.error = `Devtools stream HTTP ${response.status}`;
				} else {
					this.status = 'connected';
					retryCount = 0;

					const reader = response.body.getReader();
					const decoder = new TextDecoder();
					let buffer = '';

					while (true) {
						const { value, done } = await reader.read();
						if (done) break;
						if (token !== this.startToken) return;
						buffer += decoder.decode(value, { stream: true });

						let separator: number;
						while ((separator = buffer.indexOf('\n\n')) >= 0) {
							const frame = buffer.slice(0, separator);
							buffer = buffer.slice(separator + 2);
							this.handleFrame(parseSseData(frame));
						}
					}

					if (token === this.startToken && !signal.aborted) {
						this.status = this.sawEvent ? 'cutoff' : 'closed';
					}
				}
			} catch (err) {
				if (signal.aborted || token !== this.startToken) return;
				this.status = 'error';
				this.error = err instanceof Error ? err.message : 'Failed to read devtools stream';
			}

			if (token === this.startToken && !signal.aborted) {
				retryCount++;
				const delay = Math.min(1000 * Math.pow(1.5, retryCount), 10000);

				this.status = 'reconnecting';

				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}

	private handleFrame(data: string | null): void {
		if (data === null) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			this.status = 'error';
			this.error = 'Received malformed devtools event (invalid JSON)';
			return;
		}

		const result = DevtoolsEventSchema.safeParse(parsed);
		if (!result.success) {
			this.status = 'error';
			this.error = `Devtools event failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`;
			return;
		}

		this.sawEvent = true;
		this.events.push(result.data);
	}
}

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

const KEY = Symbol('crucible.devtools-stream');

export function setDevtoolsStream(stream: DevtoolsStream): void {
	setContext(KEY, stream);
}

export function getDevtoolsStream(): DevtoolsStream {
	const stream = getContext<DevtoolsStream | undefined>(KEY);
	if (!stream) {
		throw new Error('getDevtoolsStream() called without setDevtoolsStream() in an ancestor.');
	}
	return stream;
}
