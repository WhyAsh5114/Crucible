<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'file_write' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="file_write" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex items-center gap-2">
		<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
			>{event.path}</code
		>
		<span class="text-xs tracking-wide text-muted-foreground uppercase">{event.lang}</span>
		<span class="ml-auto font-mono text-[10px] text-muted-foreground/70"
			>{event.hash.slice(0, 12)}…</span
		>
	</div>
</EventFrame>
