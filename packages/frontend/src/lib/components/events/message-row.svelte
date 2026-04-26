<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'message' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="message" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<p class="whitespace-pre-wrap text-foreground">{event.content}</p>
</EventFrame>
