<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import EventFrame from './event-frame.svelte';
	import ChevronIcon from '@lucide/svelte/icons/chevron-down';

	interface Props {
		event: Extract<AgentEvent, { type: 'mesh_help_received' }>;
	}

	let { event }: Props = $props();

	const count = $derived(event.responses.length);
	const reqId = $derived(event.reqId);
</script>

<EventFrame label="mesh_help_received" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<Collapsible.Root>
		<Collapsible.Trigger
			class="group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/40"
		>
			<ChevronIcon
				class="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
			/>
			<span class="font-mono text-[10px] text-muted-foreground">reqId</span>
			<code class="font-mono text-[10px] text-muted-foreground/60">{reqId.slice(0, 16)}…</code>
			<span class="ml-auto font-mono text-[10px] text-muted-foreground/40"
				>{count} {count === 1 ? 'response' : 'responses'}</span
			>
		</Collapsible.Trigger>
		<Collapsible.Content
			class="mt-1 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		>
			<ul class="flex flex-col gap-1 pl-4">
				{#each event.responses as resp (resp.peerId)}
					<li class="flex flex-col gap-0.5">
						<div class="flex items-center gap-2">
							<span class="font-mono text-[10px] text-muted-foreground">peer</span>
							<code class="font-mono text-[10px] text-foreground"
								>{resp.peerId.slice(0, 12)}…</code
							>
						</div>
						{#if resp.patch}
							<code
								class="line-clamp-2 block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
								>{resp.patch.split('\n')[0]}</code
							>
						{/if}
					</li>
				{/each}
			</ul>
		</Collapsible.Content>
	</Collapsible.Root>
</EventFrame>
