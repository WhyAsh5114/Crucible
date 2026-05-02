<script lang="ts">
	import { CollapsibleTrigger } from '$lib/components/ui/collapsible/index.js';
	import { cn } from '$lib/utils';

	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	type ToolUIPartType = string;
	type ToolUIPartState =
		| 'input-streaming'
		| 'input-available'
		| 'output-available'
		| 'output-error';

	interface ToolHeaderProps {
		type: ToolUIPartType;
		state: ToolUIPartState;
		class?: string;
		[key: string]: any;
	}

	let { type, state, class: className = '', ...restProps }: ToolHeaderProps = $props();

	let id = $props.id();
</script>

<CollapsibleTrigger
	{id}
	class={cn(
		'group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/30',
		className
	)}
	{...restProps}
>
	<span
		class={cn(
			'inline-block size-1.5 shrink-0 rounded-full',
			state === 'input-streaming' && 'bg-muted-foreground/40',
			state === 'input-available' && 'animate-pulse bg-amber-400',
			state === 'output-available' && 'bg-live',
			state === 'output-error' && 'bg-destructive'
		)}
	></span>
	<span class="font-mono text-[11px] text-muted-foreground group-hover:text-foreground"
		>{type}</span
	>
	<ChevronDownIcon
		class="ml-auto size-3 shrink-0 text-muted-foreground/40 transition-transform group-data-[state=open]:rotate-180"
	/>
</CollapsibleTrigger>
