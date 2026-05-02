<script lang="ts">
	import { cn } from '$lib/utils';
	import { CollapsibleContent } from '$lib/components/ui/collapsible/index.js';
	import Response from './Response.svelte';

	interface Props {
		class?: string;
		children?: import('svelte').Snippet;
		/**
		 * Forwarded to `Response`. When set, the inner content is parsed as
		 * Markdown — preferred for live thinking/reasoning streams that contain
		 * code fences and inline formatting.
		 */
		content?: string;
	}

	let { class: className = '', children, content, ...props }: Props = $props();
</script>

<CollapsibleContent
	class={cn(
		'mt-2 text-xs',
		'text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
		className
	)}
	{...props}
>
	{#if content !== undefined}
		<Response class="grid gap-1 text-xs" {content} />
	{:else}
		<Response class="grid gap-2">
			{@render children?.()}
		</Response>
	{/if}
</CollapsibleContent>
