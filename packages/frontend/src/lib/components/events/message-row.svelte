<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';
	import Markdown from '$lib/components/ai-elements/markdown/Markdown.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'message' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="message" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<Markdown content={event.content} class="text-foreground" />
</EventFrame>
