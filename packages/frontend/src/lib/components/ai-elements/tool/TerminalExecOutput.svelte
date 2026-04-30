<script lang="ts">
	import { cn } from '$lib/utils';

	interface ExecOutput {
		stdout?: string;
		stderr?: string;
		exitCode?: number;
	}

	interface Props {
		output?: ExecOutput;
		errorText?: string;
		class?: string;
	}

	let { output, errorText, class: className = '' }: Props = $props();

	let exitCode = $derived(output?.exitCode ?? null);
	let exitOk = $derived(exitCode === 0);
	let hasStdout = $derived(!!output?.stdout?.trim());
	let hasStderr = $derived(!!output?.stderr?.trim());
	let shouldRender = $derived(!!(output || errorText));
</script>

{#if shouldRender}
	<div class={cn('space-y-2 p-4', className)}>
		<!-- header: label + exit-code badge -->
		<div class="flex items-center gap-2">
			<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				Terminal output
			</span>
			{#if exitCode !== null}
				<span
					class={cn(
						'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs font-semibold',
						exitOk ? 'bg-live/15 text-live' : 'bg-destructive/15 text-destructive'
					)}
				>
					exit&nbsp;{exitCode}
				</span>
			{/if}
		</div>

		<!-- terminal block -->
		<div class="overflow-hidden rounded-md border border-border bg-muted font-mono text-xs">
			{#if errorText}
				<!-- MCP-level error (not a shell non-zero exit) -->
				<div class="p-3 break-all whitespace-pre-wrap text-destructive">{errorText}</div>
			{:else}
				{#if hasStdout}
					<pre
						class="p-3 leading-relaxed break-all whitespace-pre-wrap text-foreground">{output?.stdout}</pre>
				{/if}

				{#if hasStdout && hasStderr}
					<div class="border-t border-border"></div>
				{/if}

				{#if hasStderr}
					<pre
						class="p-3 leading-relaxed break-all whitespace-pre-wrap text-destructive">{output?.stderr}</pre>
				{/if}

				{#if !hasStdout && !hasStderr}
					<div class="p-3 text-muted-foreground italic">(no output)</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
