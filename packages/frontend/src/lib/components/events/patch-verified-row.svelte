<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'patch_verified' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="patch_verified" tone="success" seq={event.seq} emittedAt={event.emittedAt}>
	<span class="font-mono text-[10px] text-muted-foreground/70"
		>local replay {event.localReceipt.slice(0, 14)}…</span
	>
</EventFrame>
