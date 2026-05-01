<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import Markdown from '$lib/components/ai-elements/markdown/Markdown.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'message' }>;
	}

	let { event }: Props = $props();
</script>

<div class="px-3 py-1.5 text-xs leading-normal text-foreground">
	<Markdown content={event.content} class="text-foreground" />
</div>
