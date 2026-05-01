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
	WorkspaceListResponse,
	WorkspaceState,
	PromptRequest,
	PromptResponse
} from '@crucible/types';

// Use window.location.origin so Hono RPC can construct absolute URLs
// ($url, $post, $get all call `new URL(path, base)` internally).
// Falls back to a placeholder during SSR — all actual calls happen client-side.
const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

export const apiClient = hc<AppType>(base, {
	init: { credentials: 'include' }
});

export interface ModelsResponse {
	og: { model: string } | null;
	openai: string[] | null;
}

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

	async listWorkspaces(): Promise<WorkspaceListResponse> {
		const res = await apiClient.api.workspaces.$get();
		if (!res.ok) {
			throw new Error(`listWorkspaces failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as WorkspaceListResponse;
	}

	/**
	 * Send a user prompt to the agent. The HTTP response is fast (just a
	 * stream id); model tokens are delivered over the existing
	 * `/api/agent/stream` SSE feed as `thinking` deltas plus a final
	 * `message` event.
	 */
	async sendPrompt(req: PromptRequest): Promise<PromptResponse> {
		const res = await apiClient.api.prompt.$post({ json: req });
		if (!res.ok) {
			throw new Error(`sendPrompt failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as PromptResponse;
	}

	/** Fetch available inference providers and their models. */
	async fetchModels(): Promise<ModelsResponse> {
		const res = await apiClient.api.models.$get();
		if (!res.ok) {
			throw new Error(`fetchModels failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as ModelsResponse;
	}
}

export const workspaceClient = new WorkspaceClient();
