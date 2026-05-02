<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Reasoning from '$lib/components/ai-elements/reasoning';

	interface Props {
		event: Extract<AgentEvent, { type: 'thinking' }>;
	}

	let { event }: Props = $props();
</script>

<div class="px-2 py-1">
	<Reasoning.Root class="!mb-0" defaultOpen={true}>
		<Reasoning.Trigger />
		<Reasoning.Content content={event.text} />
	</Reasoning.Root>
</div>
