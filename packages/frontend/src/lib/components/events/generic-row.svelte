<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import ChevronIcon from '@lucide/svelte/icons/chevron-down';

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
					| 'user_prompt'
					| 'revert_detected'
					| 'patch_proposed'
					| 'patch_verified'
					| 'repair_failed'
					| 'done';
			}
		>;
		repeatCount?: number;
	}

	let { event, repeatCount = 1 }: Props = $props();

	const json = $derived(JSON.stringify(event, null, 2));
	const lineCount = $derived(json.split('\n').length);
	// Tiny payloads (≤4 lines) stay inline — no point hiding them behind a
	// trigger. Bigger ones default closed so the rail doesn't get eaten by a
	// 13-line `inference_receipt` block on every turn.
	const collapsible = $derived(lineCount > 4);
	// Errors are tinted destructive; repeated identical errors get an "×N"
	// badge so the user knows the SDK retried instead of seeing N rows.
	const tone = $derived<'neutral' | 'destructive'>(
		event.type === 'error' ? 'destructive' : 'neutral'
	);
</script>

<EventFrame
	label={repeatCount > 1 ? `${event.type} ×${repeatCount}` : event.type}
	{tone}
	seq={event.seq}
	emittedAt={event.emittedAt}
>
	{#if collapsible}
		<Collapsible.Root>
			<Collapsible.Trigger
				class="group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-muted-foreground transition-colors hover:bg-muted/40"
			>
				<ChevronIcon
					class="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-180"
				/>
				<span class="font-mono text-[11px]">{lineCount} lines</span>
			</Collapsible.Trigger>
			<Collapsible.Content
				class="mt-2 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
			>
				<pre
					class="overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-snug text-muted-foreground">{json}</pre>
			</Collapsible.Content>
		</Collapsible.Root>
	{:else}
		<pre
			class="overflow-x-auto rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-snug text-muted-foreground">{json}</pre>
	{/if}
</EventFrame>
