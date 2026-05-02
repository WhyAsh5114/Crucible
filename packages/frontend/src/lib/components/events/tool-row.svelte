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

	/** Use the terminal-styled renderer for exec output; fall back to JSON for everything else. */
	let isTerminalExec = $derived(call.tool === 'terminal.exec');

	/** Narrowed output for the terminal renderer. Safe because exec always returns this shape. */
	let execOutput = $derived(
		isTerminalExec && output
			? ((
					output as {
						structuredContent?: { stdout?: string; stderr?: string; exitCode?: number };
					}
				).structuredContent ?? (output as { stdout?: string; stderr?: string; exitCode?: number }))
			: undefined
	);
</script>

<div class="border-b border-border/20 px-3 py-1.5">
	<Tool.Root class="!mb-0 border-0 bg-transparent shadow-none">
		<Tool.Header type={call.tool} {state} />
		<Tool.Content>
			<Tool.Input input={call.args} />
			{#if isTerminalExec}
				<Tool.ExecOutput output={execOutput} {errorText} />
			{:else}
				<Tool.Output {output} {errorText} />
			{/if}
		</Tool.Content>
	</Tool.Root>
</div>
