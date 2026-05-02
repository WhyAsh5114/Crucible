<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Code from '$lib/components/ai-elements/code';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import EventFrame from './event-frame.svelte';
	import ChevronIcon from '@lucide/svelte/icons/chevron-down';

	interface Props {
		event: Extract<AgentEvent, { type: 'patch_proposed' }>;
	}

	let { event }: Props = $props();

	const lineCount = $derived(event.patch.split('\n').length);
</script>

<EventFrame label="patch_proposed" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<Collapsible.Root>
		<Collapsible.Trigger
			class="group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/40"
		>
			<ChevronIcon
				class="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
			/>
			<span class="font-mono text-[10px] text-muted-foreground">source</span>
			<code class="rounded bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground"
				>{event.source}</code
			>
			<span class="ml-auto font-mono text-[10px] text-muted-foreground/60"
				>{lineCount} lines</span
			>
		</Collapsible.Trigger>
		<Collapsible.Content
			class="mt-1 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		>
			<Code.Root code={event.patch} lang="diff" hideLines>
				<Code.CopyButton />
			</Code.Root>
		</Collapsible.Content>
	</Collapsible.Root>
</EventFrame>
