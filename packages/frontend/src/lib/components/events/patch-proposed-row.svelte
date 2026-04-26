<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Code from '$lib/components/ai-elements/code';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'patch_proposed' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="patch_proposed" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-2">
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<span>source</span>
			<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{event.source}</code>
		</div>
		<Code.Root code={event.patch} lang="diff" hideLines>
			<Code.CopyButton />
		</Code.Root>
	</div>
</EventFrame>
