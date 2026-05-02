<script lang="ts">
	import type { AgentEvent } from '@crucible/types';

	interface Props {
		event: Extract<AgentEvent, { type: 'user_prompt' }>;
	}

	let { event }: Props = $props();
</script>

<div class="border-b border-border/20 px-3 py-2.5">
	<div
		class="flex items-baseline gap-1.5 rounded-md border-l-2 border-primary/60 bg-muted/30 px-2.5 py-1.5"
	>
		<span
			class="shrink-0 rounded bg-primary/15 px-1.5 py-0 font-mono text-[10px] font-semibold tracking-wide text-primary uppercase"
			>you</span
		>
		<p class="text-xs leading-normal text-foreground">{event.content}</p>
	</div>
</div>
