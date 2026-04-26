<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import * as Tool from '$lib/components/ai-elements/tool';

	interface Props {
		call: Extract<AgentEvent, { type: 'tool_call' }>;
		result: Extract<AgentEvent, { type: 'tool_result' }> | null;
	}

	let { call, result }: Props = $props();

	type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

	let state = $derived<ToolState>(
		!result ? 'input-available' : result.outcome.ok ? 'output-available' : 'output-error'
	);

	let output = $derived(result && result.outcome.ok ? result.outcome.result : undefined);
	let errorText = $derived(result && !result.outcome.ok ? result.outcome.error : undefined);
</script>

<div class="px-4 py-2">
	<Tool.Root class="!mb-0 border-border">
		<Tool.Header type={call.tool} {state} />
		<Tool.Content>
			<Tool.Input input={call.args} />
			<Tool.Output {output} {errorText} />
		</Tool.Content>
	</Tool.Root>
</div>
