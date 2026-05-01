<script lang="ts">
	import * as Conversation from '$lib/components/ai-elements/conversation';
	import type { StickToBottomContext } from '$lib/components/ai-elements/conversation/stick-to-bottom-context.svelte';
	import { Loader } from '$lib/components/ai-elements/loader';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import { workspaceClient } from '$lib/api/workspace';
	import { Button } from '$lib/components/ui/button';
	import EventRow from './events/event-row.svelte';
	import ToolRow from './events/tool-row.svelte';
	import { pairToolEvents } from './events/pair-tool-events';
	import EmptyState from './empty-state.svelte';
	import ModelPicker from './model-picker.svelte';
	import type { ModelSelection } from './model-picker.svelte';
	import SendIcon from '@lucide/svelte/icons/send';
	import StopIcon from '@lucide/svelte/icons/square';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { setContext } from 'svelte';
	import type { WorkspaceId } from '@crucible/types';

	interface Props {
		workspaceId: WorkspaceId;
	}

	let { workspaceId }: Props = $props();

	const stream = getAgentStream();
	let items = $derived(pairToolEvents(stream.events));

	// ── Session state ─────────────────────────────────────────────────────────
	let sessions = $state<{ id: string; title: string; createdAt: number; updatedAt: number }[]>([]);
	let activeSessionId = $state<string | null>(null);
	let sessionError = $state<string | null>(null);
	// Inline rename state
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');

	async function loadSessions(): Promise<void> {
		sessionError = null;
		try {
			const res = await workspaceClient.listSessions(workspaceId);
			sessions = res.sessions;
			// Keep the active session if it still exists, else pick the most recent.
			const currentStillExists = activeSessionId && sessions.some((s) => s.id === activeSessionId);
			if (!currentStillExists) {
				const mostRecent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
				if (mostRecent) await switchSession(mostRecent.id, false);
			}
		} catch (err) {
			sessionError = err instanceof Error ? err.message : String(err);
		}
	}

	async function switchSession(sessionId: string, reload = true): Promise<void> {
		if (sessionId === activeSessionId && !reload) return;
		activeSessionId = sessionId;
		stream.stop();
		stream.clear();
		await stream.hydrate(workspaceId, sessionId);
		stream.start(workspaceId, sessionId);
	}

	async function newSession(): Promise<void> {
		try {
			const res = await workspaceClient.createSession(workspaceId);
			sessions = res.sessions;
			const newest = [...res.sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
			if (newest) await switchSession(newest.id, false);
		} catch (err) {
			sessionError = err instanceof Error ? err.message : String(err);
		}
	}

	async function deleteSession(sessionId: string): Promise<void> {
		try {
			await workspaceClient.deleteSession(workspaceId, sessionId);
			await loadSessions();
		} catch (err) {
			sessionError = err instanceof Error ? err.message : String(err);
		}
	}

	function startRename(session: { id: string; title: string }): void {
		renamingId = session.id;
		renameValue = session.title;
	}

	async function commitRename(sessionId: string): Promise<void> {
		const title = renameValue.trim();
		if (!title) {
			cancelRename();
			return;
		}
		try {
			const res = await workspaceClient.renameSession(workspaceId, sessionId, { title });
			sessions = res.sessions;
		} catch (err) {
			sessionError = err instanceof Error ? err.message : String(err);
		} finally {
			renamingId = null;
		}
	}

	function cancelRename(): void {
		renamingId = null;
		renameValue = '';
	}

	// Load sessions on mount and whenever workspaceId changes.
	$effect(() => {
		void loadSessions();
	});

	let prompt = $state('');
	let sending = $state(false);
	let cancelling = $state(false);
	let sendError = $state<string | null>(null);
	let lastPrompt = $state<string | null>(null);

	// Default to 0G with a placeholder model id; the picker updates this once
	// it fetches /api/models. The placeholder is never sent to the backend
	// because the backend uses OG_MODEL from env when provider is '0g'.
	let selectedModel = $state<ModelSelection>({ provider: '0g', model: '' });

	// Stick-to-bottom controller from Conversation.Root, bound below. The
	// MutationObserver inside auto-scrolls only while the user is at bottom;
	// once they scroll up to read, `userHasScrolled` stays true. We call
	// `scrollToBottom` on every prompt submit so a new turn always lands in
	// view, regardless of where the user's reading position drifted to.
	let stick = $state<StickToBottomContext | undefined>();

	// While the agent is mid-turn we hide the send button and surface a
	// stop button instead. `streaming` covers active token output; `connecting`
	// means the SSE handshake is still in flight (the prompt POST has fired
	// but the first event hasn't arrived yet) — both should let the user back
	// out without waiting for completion.
	let inFlight = $derived(
		sending || stream.status === 'streaming' || stream.status === 'connecting'
	);

	async function sendPrompt(text: string, forceFallback: boolean): Promise<void> {
		sending = true;
		sendError = null;
		stick?.scrollToBottom('smooth');
		try {
			const useOpenAi = forceFallback || selectedModel.provider === 'openai';
			await workspaceClient.sendPrompt({
				workspaceId,
				prompt: text,
				...(activeSessionId ? { sessionId: activeSessionId } : {}),
				...(useOpenAi
					? {
							force_openai_fallback: true,
							...(selectedModel.provider === 'openai' ? { model: selectedModel.model } : {})
						}
					: {})
			});
			lastPrompt = text;
		} catch (err) {
			sendError = err instanceof Error ? err.message : String(err);
		} finally {
			sending = false;
		}
	}

	async function handleCancel(): Promise<void> {
		if (cancelling) return;
		cancelling = true;
		sendError = null;
		try {
			await workspaceClient.cancelAgent(workspaceId);
		} catch (err) {
			sendError = err instanceof Error ? err.message : String(err);
		} finally {
			cancelling = false;
		}
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const trimmed = prompt.trim();
		if (!trimmed || inFlight) return;
		await sendPrompt(trimmed, false);
		if (!sendError) prompt = '';
	}

	// Provide a retry callback to descendant `error-row.svelte` components so
	// the user can re-run the last prompt against the OpenAI-compatible
	// fallback after a 0G Compute Router failure.
	setContext('retryWithFallback', () => {
		if (lastPrompt && !inFlight) void sendPrompt(lastPrompt, true);
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			const form = (event.currentTarget as HTMLTextAreaElement).form;
			form?.requestSubmit();
		}
	}
</script>

<aside class="flex h-full min-h-0 flex-col bg-background">
	<header class="shrink-0 border-b border-border bg-muted/20 px-2 py-1.5">
		<div class="flex items-center gap-2">
			<h2 class="text-xs font-medium tracking-tight text-foreground">Agent</h2>
			<div class="flex items-center gap-1 font-mono text-[10px] uppercase">
				{#if stream.status === 'streaming'}
					<Loader class="size-2.5 text-live" />
					<span class="text-live">streaming</span>
				{:else if stream.status === 'connecting'}
					<Loader class="size-2.5 text-muted-foreground" />
					<span class="text-muted-foreground">connecting</span>
				{:else if stream.status === 'error'}
					<span class="text-destructive">error</span>
				{/if}
			</div>
			<div class="ml-auto">
				<ModelPicker value={selectedModel} onchange={(sel) => (selectedModel = sel)} />
			</div>
		</div>
	</header>

	<!-- Session picker ────────────────────────────────────────────────────── -->
	<div
		class="session-bar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-muted/10 px-2 py-1"
	>
		{#each sessions as session (session.id)}
			{@const isActive = session.id === activeSessionId}
			{@const isRenaming = renamingId === session.id}
			<div
				class="group relative flex min-w-0 shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors {isActive
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
			>
				{#if isRenaming}
					<input
						type="text"
						bind:value={renameValue}
						class="w-24 min-w-0 border-0 bg-transparent text-[10px] font-medium focus:outline-none"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void commitRename(session.id);
							}
							if (e.key === 'Escape') {
								e.preventDefault();
								cancelRename();
							}
						}}
					/>
					<button
						type="button"
						onclick={() => void commitRename(session.id)}
						class="ml-0.5 text-muted-foreground hover:text-foreground"
						aria-label="Confirm rename"
					>
						<CheckIcon class="size-2.5" />
					</button>
					<button
						type="button"
						onclick={cancelRename}
						class="ml-0.5 text-muted-foreground hover:text-foreground"
						aria-label="Cancel rename"
					>
						<XIcon class="size-2.5" />
					</button>
				{:else}
					<button
						type="button"
						onclick={() => void switchSession(session.id)}
						class="max-w-[8rem] truncate"
						title={session.title}
					>
						{session.title}
					</button>
					<!-- Action icons, shown on hover or when active -->
					<span class="ml-1 hidden items-center gap-0.5 group-hover:flex {isActive ? 'flex' : ''}">
						<button
							type="button"
							onclick={() => startRename(session)}
							class="text-muted-foreground hover:text-foreground"
							aria-label="Rename session"
						>
							<PencilIcon class="size-2.5" />
						</button>
						{#if sessions.length > 1}
							<button
								type="button"
								onclick={() => void deleteSession(session.id)}
								class="text-muted-foreground hover:text-destructive"
								aria-label="Delete session"
							>
								<Trash2Icon class="size-2.5" />
							</button>
						{/if}
					</span>
				{/if}
			</div>
		{/each}

		<button
			type="button"
			onclick={() => void newSession()}
			class="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
			aria-label="New chat session"
			title="New chat"
		>
			<PlusIcon class="size-3" />
		</button>
	</div>
	{#if sessionError}
		<p class="px-2 py-0.5 font-mono text-[10px] text-destructive">{sessionError}</p>
	{/if}

	<Conversation.Root bind:stick class="min-h-0 flex-1">
		<Conversation.Content class="!p-0">
			{#if stream.events.length === 0 && stream.status === 'error'}
				<EmptyState
					variant="degraded"
					title="Stream not connected"
					description={stream.error ?? 'Agent stream connection failed.'}
				/>
			{:else if stream.events.length === 0}
				<EmptyState
					title="Ready when you are"
					description="Send a prompt below to start a conversation with the agent."
				/>
			{:else}
				<ol class="flex flex-col">
					{#each items as item (item.key)}
						<li>
							{#if item.kind === 'tool'}
								<ToolRow call={item.call} result={item.result} />
							{:else}
								<EventRow event={item.event} repeatCount={item.repeatCount} />
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</Conversation.Content>
		<Conversation.ScrollButton />
	</Conversation.Root>

	<form onsubmit={handleSubmit} class="shrink-0 border-t border-border bg-muted/10 p-2">
		{#if sendError}
			<p class="mb-1.5 font-mono text-[10px] text-destructive">{sendError}</p>
		{/if}
		<div
			class="flex items-end gap-1.5 rounded border border-border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring"
		>
			<textarea
				bind:value={prompt}
				onkeydown={handleKeydown}
				placeholder="Ask the agent… (Enter · Shift+Enter newline)"
				rows={1}
				disabled={inFlight}
				class="min-h-[1.5rem] flex-1 resize-none bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
			></textarea>
			{#if inFlight}
				<Button
					type="button"
					size="icon"
					variant="destructive"
					onclick={handleCancel}
					disabled={cancelling}
					aria-label="Cancel agent"
					class="shrink-0"
				>
					{#if cancelling}
						<Loader class="size-4" />
					{:else}
						<StopIcon class="size-4" />
					{/if}
				</Button>
			{:else}
				<Button
					type="submit"
					size="icon"
					variant="default"
					disabled={prompt.trim().length === 0}
					aria-label="Send prompt"
					class="shrink-0"
				>
					<SendIcon class="size-4" />
				</Button>
			{/if}
		</div>
	</form>
</aside>
