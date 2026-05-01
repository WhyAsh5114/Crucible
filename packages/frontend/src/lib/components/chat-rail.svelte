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
	import { setContext } from 'svelte';
	import type { WorkspaceId } from '@crucible/types';

	interface Props {
		workspaceId: WorkspaceId;
	}

	let { workspaceId }: Props = $props();

	const stream = getAgentStream();
	let items = $derived(pairToolEvents(stream.events));

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
	<header class="shrink-0 border-b border-border bg-muted/20 px-3 py-2">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-sm font-medium tracking-tight text-foreground">Agent</h2>
			<div class="flex items-center gap-1 font-mono text-[11px] uppercase">
				{#if stream.status === 'streaming'}
					<Loader class="size-3 text-live" />
					<span class="text-live">streaming</span>
				{:else if stream.status === 'connecting'}
					<Loader class="size-3 text-muted-foreground" />
					<span class="text-muted-foreground">connecting</span>
				{:else if stream.status === 'closed'}
					<span class="text-muted-foreground">closed</span>
				{:else if stream.status === 'error'}
					<span class="text-destructive">error</span>
				{:else}
					<span class="text-muted-foreground">idle</span>
				{/if}
			</div>
		</div>
		<div class="mt-1.5">
			<ModelPicker value={selectedModel} onchange={(sel) => (selectedModel = sel)} />
		</div>
	</header>

	<Conversation.Root class="min-h-0 flex-1" bind:stick>
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

	<form onsubmit={handleSubmit} class="shrink-0 border-t border-border bg-muted/10 p-3">
		{#if sendError}
			<p class="mb-2 font-mono text-[11px] text-destructive">{sendError}</p>
		{/if}
		<div
			class="flex items-end gap-2 rounded-md border border-border bg-background p-2 focus-within:ring-1 focus-within:ring-ring"
		>
			<textarea
				bind:value={prompt}
				onkeydown={handleKeydown}
				placeholder="Ask the agent…  (Enter to send, Shift+Enter for newline)"
				rows={2}
				disabled={inFlight}
				class="min-h-[2.5rem] flex-1 resize-none bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
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
