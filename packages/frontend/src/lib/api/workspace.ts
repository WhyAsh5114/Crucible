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
	WorkspaceUpdateRequest,
	WorkspaceUpdateResponse,
	WorkspaceDeleteResponse,
	PromptRequest,
	PromptResponse,
	AgentEvent,
	ChatSessionListResponse,
	ChatSessionCreateRequest,
	ChatSessionRenameRequest,
	ChatSessionDeleteResponse,
	MemoryPattern
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

	async renameWorkspace(id: string, req: WorkspaceUpdateRequest): Promise<WorkspaceUpdateResponse> {
		const res = await apiClient.api.workspace[':id'].$patch({
			param: { id },
			json: req
		});
		if (!res.ok) {
			throw new Error(`renameWorkspace failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as WorkspaceUpdateResponse;
	}

	async deleteWorkspace(id: string): Promise<WorkspaceDeleteResponse> {
		const res = await apiClient.api.workspace[':id'].$delete({ param: { id } });
		if (!res.ok) {
			throw new Error(`deleteWorkspace failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as WorkspaceDeleteResponse;
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

	/**
	 * Fetch the persisted chat history for a workspace session. Returns the raw
	 * `AgentEvent` log so the caller can replay it through the same coalescing
	 * pipeline that handles live SSE frames.
	 */
	async getChatHistory(id: string, sessionId?: string): Promise<AgentEvent[]> {
		const res = await apiClient.api.workspace[':id'].chat.history.$get({
			param: { id },
			query: sessionId ? { sessionId } : {}
		});
		if (!res.ok) {
			throw new Error(`getChatHistory failed: ${res.status} ${await res.text()}`);
		}
		const body = (await res.json()) as { events: AgentEvent[] };
		return body.events;
	}

	/**
	 * Abort the workspace's currently-running agent turn, if any. Resolves to
	 * `true` when a turn was cancelled and `false` when there was no in-flight
	 * controller to abort (already finished or never started).
	 */
	async cancelAgent(id: string): Promise<boolean> {
		const res = await apiClient.api.workspace[':id'].cancel.$post({
			param: { id }
		});
		if (!res.ok) {
			throw new Error(`cancelAgent failed: ${res.status} ${await res.text()}`);
		}
		const body = (await res.json()) as { cancelled: boolean };
		return body.cancelled;
	}

	/** Fetch available inference providers and their models. */
	async fetchModels(): Promise<ModelsResponse> {
		const res = await apiClient.api.models.$get();
		if (!res.ok) {
			throw new Error(`fetchModels failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as ModelsResponse;
	}

	// ── Chat sessions ────────────────────────────────────────────────────────

	async listSessions(workspaceId: string): Promise<ChatSessionListResponse> {
		const res = await apiClient.api.workspace[':id'].sessions.$get({
			param: { id: workspaceId }
		});
		if (!res.ok) {
			throw new Error(`listSessions failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as ChatSessionListResponse;
	}

	async createSession(
		workspaceId: string,
		req: ChatSessionCreateRequest = {}
	): Promise<ChatSessionListResponse> {
		const res = await apiClient.api.workspace[':id'].sessions.$post({
			param: { id: workspaceId },
			json: req
		});
		if (!res.ok) {
			throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as ChatSessionListResponse;
	}

	async renameSession(
		workspaceId: string,
		sessionId: string,
		req: ChatSessionRenameRequest
	): Promise<ChatSessionListResponse> {
		const res = await apiClient.api.workspace[':id'].sessions[':sessionId'].$patch({
			param: { id: workspaceId, sessionId },
			json: req
		});
		if (!res.ok) {
			throw new Error(`renameSession failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as ChatSessionListResponse;
	}

	async deleteSession(workspaceId: string, sessionId: string): Promise<ChatSessionDeleteResponse> {
		const res = await apiClient.api.workspace[':id'].sessions[':sessionId'].$delete({
			param: { id: workspaceId, sessionId }
		});
		if (!res.ok) {
			throw new Error(`deleteSession failed: ${res.status} ${await res.text()}`);
		}
		return (await res.json()) as ChatSessionDeleteResponse;
	}

	// ── Memory ───────────────────────────────────────────────────────────────

	async listMemoryPatterns(
		workspaceId: string,
		scope?: 'local' | 'mesh'
	): Promise<MemoryPattern[]> {
		const res = await apiClient.api.workspace[':id'].memory.patterns.$get({
			param: { id: workspaceId },
			query: scope ? { scope } : {}
		});
		if (!res.ok) throw new Error(`listMemoryPatterns failed: ${res.status} ${await res.text()}`);
		const body = (await res.json()) as { patterns: MemoryPattern[] };
		return body.patterns;
	}

	async embedMemoryPatterns(workspaceId: string): Promise<{ id: string; vector: number[] }[]> {
		const res = await apiClient.api.workspace[':id'].memory.embed.$get({
			param: { id: workspaceId }
		});
		if (!res.ok) return []; // graceful degradation — embeddings unavailable
		const body = (await res.json()) as { embeddings: { id: string; vector: number[] }[] };
		return body.embeddings;
	}

	async purgeMemory(workspaceId: string, scope?: 'local' | 'mesh'): Promise<number> {
		const res = await apiClient.api.workspace[':id'].memory.$delete({
			param: { id: workspaceId },
			query: scope ? { scope } : {}
		});
		if (!res.ok) throw new Error(`purgeMemory failed: ${res.status} ${await res.text()}`);
		const body = (await res.json()) as { deleted: number };
		return body.deleted;
	}
}

export const workspaceClient = new WorkspaceClient();
