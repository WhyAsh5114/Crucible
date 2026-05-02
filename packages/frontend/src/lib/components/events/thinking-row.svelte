<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Reasoning from '$lib/components/ai-elements/reasoning';

	interface Props {
		event: Extract<AgentEvent, { type: 'thinking' }>;
	}

	let { event }: Props = $props();
</script>

<div class="border-b border-border/20 px-3 py-1.5">
	<Reasoning.Root class="!mb-0" defaultOpen={false}>
		<Reasoning.Trigger class="text-xs" />
		<Reasoning.Content content={event.text} />
	</Reasoning.Root>
</div>
