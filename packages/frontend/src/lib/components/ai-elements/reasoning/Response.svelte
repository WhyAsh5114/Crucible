<script lang="ts">
	import { cn } from '$lib/utils';
	import Markdown from '$lib/components/ai-elements/markdown/Markdown.svelte';

	interface Props {
		class?: string;
		children?: import('svelte').Snippet;
		/**
		 * When set, renders `content` as Markdown via Streamdown. When omitted,
		 * falls back to `children` so existing callers that pass plain text or
		 * pre-rendered nodes (e.g. `Reasoning.Content`) keep working.
		 */
		content?: string;
	}

	let { class: className = '', children, content, ...props }: Props = $props();
</script>

<div class={cn('prose prose-sm max-w-none', className)} {...props}>
	{#if content !== undefined}
		<Markdown {content} />
	{:else}
		{@render children?.()}
	{/if}
</div>
