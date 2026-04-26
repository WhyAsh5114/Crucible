<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'done' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="done" tone="success" seq={event.seq} emittedAt={event.emittedAt}>
	<span class="text-muted-foreground">Stream complete.</span>
</EventFrame>
