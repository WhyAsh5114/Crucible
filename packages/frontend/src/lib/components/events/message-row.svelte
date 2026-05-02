<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import Markdown from '$lib/components/ai-elements/markdown/Markdown.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'message' }>;
	}

	let { event }: Props = $props();
</script>

<div class="border-b border-border/20 px-3 py-2 text-xs leading-relaxed text-foreground">
	<Markdown content={event.content} class="text-foreground" />
</div>
