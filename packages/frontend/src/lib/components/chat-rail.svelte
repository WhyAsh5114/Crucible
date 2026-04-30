<script lang="ts">
	import * as Conversation from '$lib/components/ai-elements/conversation';
	import { Loader } from '$lib/components/ai-elements/loader';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import { workspaceClient } from '$lib/api/workspace';
	import { Button } from '$lib/components/ui/button';
	import EventRow from './events/event-row.svelte';
	import ToolRow from './events/tool-row.svelte';
	import { pairToolEvents } from './events/pair-tool-events';
	import EmptyState from './empty-state.svelte';
	import SendIcon from '@lucide/svelte/icons/send';
	import LoaderIcon from '@lucide/svelte/icons/loader';
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
	let sendError = $state<string | null>(null);
	let lastPrompt = $state<string | null>(null);

	async function sendPrompt(text: string, forceFallback: boolean): Promise<void> {
		sending = true;
		sendError = null;
		try {
			await workspaceClient.sendPrompt({
				workspaceId,
				prompt: text,
				...(forceFallback ? { force_openai_fallback: true } : {}),
			});
			lastPrompt = text;
		} catch (err) {
			sendError = err instanceof Error ? err.message : String(err);
		} finally {
			sending = false;
		}
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const trimmed = prompt.trim();
		if (!trimmed || sending) return;
		await sendPrompt(trimmed, false);
		if (!sendError) prompt = '';
	}

	// Provide a retry callback to descendant `error-row.svelte` components so
	// the user can re-run the last prompt against the OpenAI-compatible
	// fallback after a 0G Compute Router failure.
	setContext('retryWithFallback', () => {
		if (lastPrompt && !sending) void sendPrompt(lastPrompt, true);
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
	<header class="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-sm font-medium tracking-tight text-foreground">Agent</h2>
			<div class="flex items-center gap-2 font-mono text-[11px] uppercase">
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
	</header>

	<Conversation.Root class="min-h-0 flex-1">
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
								<EventRow event={item.event} />
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
				disabled={sending}
				class="min-h-[2.5rem] flex-1 resize-none bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
			></textarea>
			<Button
				type="submit"
				size="icon"
				variant="default"
				disabled={sending || prompt.trim().length === 0}
				aria-label="Send prompt"
				class="shrink-0"
			>
				{#if sending || stream.status === 'streaming'}
					<LoaderIcon class="size-4 animate-spin" />
				{:else}
					<SendIcon class="size-4" />
				{/if}
			</Button>
		</div>
	</form>
</aside>
