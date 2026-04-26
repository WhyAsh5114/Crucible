<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Exclude<
			AgentEvent,
			{
				type:
					| 'thinking'
					| 'tool_call'
					| 'tool_result'
					| 'file_write'
					| 'message'
					| 'revert_detected'
					| 'patch_proposed'
					| 'patch_verified'
					| 'done';
			}
		>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label={event.type} tone="neutral" seq={event.seq} emittedAt={event.emittedAt}>
	<pre
		class="overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-snug text-muted-foreground">{JSON.stringify(
			event,
			null,
			2
		)}</pre>
</EventFrame>
