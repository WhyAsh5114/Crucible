<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'repair_failed' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="repair_failed" tone="destructive" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-1">
		<span class="text-sm font-medium text-destructive">
			Self-healing failed after {event.attempts} attempt{event.attempts === 1 ? '' : 's'}.
		</span>
		<code class="font-mono text-xs text-muted-foreground">{event.lastRevertSignature}</code>
	</div>
</EventFrame>
