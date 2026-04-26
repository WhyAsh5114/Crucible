<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'revert_detected' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="revert_detected" tone="destructive" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-1">
		<code class="font-mono text-xs text-destructive">{event.revertSignature}</code>
		<span class="font-mono text-[10px] text-muted-foreground/70"
			>tx {event.txHash.slice(0, 14)}…</span
		>
	</div>
</EventFrame>
