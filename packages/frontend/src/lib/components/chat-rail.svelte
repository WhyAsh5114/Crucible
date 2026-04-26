<script lang="ts">
	import * as Conversation from '$lib/components/ai-elements/conversation';
	import { Loader } from '$lib/components/ai-elements/loader';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import EventRow from './events/event-row.svelte';
	import ToolRow from './events/tool-row.svelte';
	import { pairToolEvents } from './events/pair-tool-events';
	import EmptyState from './empty-state.svelte';

	const stream = getAgentStream();
	let items = $derived(pairToolEvents(stream.events));
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
					title="No agent activity yet"
					description="The live agent stream is connected. Events will appear here as the backend produces them."
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

	<div class="shrink-0 border-t border-border p-3">
		<div
			class="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 font-mono text-[11px] text-muted-foreground"
		>
			<span class="size-1.5 rounded-full bg-muted-foreground/40"></span>
			<span>
				Prompt input pending — agent inference is not yet wired (see PLAN.md POV-1).
			</span>
		</div>
	</div>
</aside>
