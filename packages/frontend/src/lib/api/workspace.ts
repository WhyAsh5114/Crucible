/**
 * Workspace API client. Built on Hono RPC against the backend's typed
 * `AppType`, so request and response shapes are inferred end-to-end from
 * the route definitions in `@crucible/backend`.
 */

import { hc } from 'hono/client';
import type { AppType } from '@crucible/backend';
import type {
	WorkspaceCreateRequest,
	WorkspaceCreateResponse,
	WorkspaceState
} from '@crucible/types';

// Browser-relative base — Vite proxies `/api/*` to the backend in dev,
// and the production reverse proxy serves both under one origin.
export const apiClient = hc<AppType>('/', {
	init: { credentials: 'include' }
});

export class WorkspaceClient {
	async createWorkspace(req: WorkspaceCreateRequest): Promise<WorkspaceCreateResponse> {
		const res = await apiClient.api.workspace.$post({ json: req });
		if (!res.ok) {
			throw new Error(`createWorkspace failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as WorkspaceCreateResponse;
	}

	async getWorkspace(id: string): Promise<WorkspaceState> {
		const res = await apiClient.api.workspace[':id'].$get({ param: { id } });
		if (!res.ok) {
			throw new Error(`getWorkspace failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as WorkspaceState;
	}
}

export const workspaceClient = new WorkspaceClient();
