<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Code from '$lib/components/ai-elements/code/index.js';

	interface ToolInputProps {
		class?: string;
		input: any;
		[key: string]: any;
	}

	let { class: className = '', input, ...restProps }: ToolInputProps = $props();

	let formattedInput = $derived.by(() => {
		return JSON.stringify(input, null, 2);
	});

	let id = $props.id();
</script>

<div {id} class={cn('space-y-1.5 overflow-hidden px-2 py-2', className)} {...restProps}>
	<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Parameters</h4>
	<div class="rounded-md bg-muted/50 [&_pre.shiki]:py-2 [&_pre.shiki]:text-xs">
		<Code.Root code={formattedInput} lang="json" hideLines>
			<Code.CopyButton />
		</Code.Root>
	</div>
</div>
