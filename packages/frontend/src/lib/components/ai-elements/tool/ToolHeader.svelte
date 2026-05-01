<script lang="ts">
	import { CollapsibleTrigger } from '$lib/components/ui/collapsible/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { cn } from '$lib/utils';

	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';

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

	let getStatusBadge = $derived.by(() => {
		let labels = {
			'input-streaming': 'Pending',
			'input-available': 'Running',
			'output-available': 'Completed',
			'output-error': 'Error'
		} as const;

		let icons = {
			'input-streaming': CircleIcon,
			'input-available': ClockIcon,
			'output-available': CheckCircleIcon,
			'output-error': XCircleIcon
		} as const;

		let IconComponent = icons[state];
		let label = labels[state];

		return { IconComponent, label };
	});
	let IconComponent = $derived(getStatusBadge.IconComponent);

	let id = $props.id();
</script>

<CollapsibleTrigger
	{id}
	class={cn('flex w-full items-center justify-between gap-2 px-2 py-1', className)}
	{...restProps}
>
	<div class="flex items-center gap-1.5">
		<WrenchIcon class="size-3 text-muted-foreground" />
		<span class="font-mono text-xs font-medium">{type}</span>
		<Badge class="gap-1 rounded-full px-1.5 py-0 text-[10px]" variant="secondary">
			<IconComponent
				class={cn(
					'size-3',
					state === 'input-available' && 'animate-pulse',
					state === 'output-available' && 'text-live',
					state === 'output-error' && 'text-destructive'
				)}
			/>
		</Badge>
	</div>
	<ChevronDownIcon
		class="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
	/>
</CollapsibleTrigger>
