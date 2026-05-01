<script lang="ts">
	import type { AgentEvent } from '@crucible/types';

	interface Props {
		event: Extract<AgentEvent, { type: 'done' }>;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let { event }: Props = $props();
</script>

<div class="mx-3 my-1.5 border-t border-border/40" aria-hidden="true"></div>
