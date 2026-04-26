<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Reasoning from '$lib/components/ai-elements/reasoning';

	interface Props {
		event: Extract<AgentEvent, { type: 'thinking' }>;
	}

	let { event }: Props = $props();
</script>

<div class="px-4 py-2">
	<Reasoning.Root class="!mb-0" defaultOpen={false}>
		<Reasoning.Trigger />
		<Reasoning.Content>
			{event.text}
		</Reasoning.Content>
	</Reasoning.Root>
</div>
