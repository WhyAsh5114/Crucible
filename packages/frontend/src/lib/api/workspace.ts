/**
 * Workspace API client. Speaks the typed contracts from `@crucible/types`.
 *
 * Phase 0/1: when `PUBLIC_USE_FIXTURES !== 'false'`, both calls return canned
 * data so the UI runs end-to-end without a backend. Flip the env var once
 * `/api/workspace` exists.
 */

import { env } from '$env/dynamic/public';
import {
	type WorkspaceCreateRequest,
	type WorkspaceCreateResponse,
	type WorkspaceState
} from '@crucible/types';
import { fixtureWorkspaceState } from '$lib/fixtures/workspace';

const FIXTURES_ENABLED = (env.PUBLIC_USE_FIXTURES ?? 'true') !== 'false';

export interface WorkspaceClientOptions {
	/** Override the runtime fixture flag (used by tests). */
	useFixtures?: boolean;
}

export class WorkspaceClient {
	private readonly useFixtures: boolean;

	constructor(opts: WorkspaceClientOptions = {}) {
		this.useFixtures = opts.useFixtures ?? FIXTURES_ENABLED;
	}

	async createWorkspace(req: WorkspaceCreateRequest): Promise<WorkspaceCreateResponse> {
		if (this.useFixtures) {
			return { id: fixtureWorkspaceState.id };
		}
		const res = await fetch('/api/workspace', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(req)
		});
		if (!res.ok) throw new Error(`createWorkspace failed: ${res.status}`);
		return (await res.json()) as WorkspaceCreateResponse;
	}

	async getWorkspace(id: string): Promise<WorkspaceState> {
		if (this.useFixtures) {
			return fixtureWorkspaceState;
		}
		const res = await fetch(`/api/workspace/${encodeURIComponent(id)}`);
		if (!res.ok) throw new Error(`getWorkspace failed: ${res.status}`);
		return (await res.json()) as WorkspaceState;
	}
}

export const workspaceClient = new WorkspaceClient();
