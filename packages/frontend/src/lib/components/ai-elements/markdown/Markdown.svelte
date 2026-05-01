<script lang="ts">
	/**
	 * Streaming-friendly Markdown renderer.
	 *
	 * Wraps `svelte-streamdown` so the rest of the app has a single import
	 * point and so we can pin the code-block renderer to our shadcn-svelte-
	 * extras style `Code.svelte` (Shiki-backed) — Streamdown's default code
	 * block uses its own UI which doesn't match the IDE chrome.
	 *
	 * `parseIncompleteMarkdown` is on by default so live-streaming agent
	 * tokens render sensibly even when a code fence or list isn't yet
	 * terminated.
	 */
	import { Streamdown } from 'svelte-streamdown';
	import { cn } from '$lib/utils';
	import MarkdownCodeBlock from './MarkdownCodeBlock.svelte';

	interface Props {
		content: string;
		class?: string;
	}

	let { content, class: className }: Props = $props();
</script>

<div class={cn('prose prose-sm max-w-none', className)}>
	<Streamdown
		{content}
		parseIncompleteMarkdown
		baseTheme="shadcn"
		components={{ code: MarkdownCodeBlock }}
	/>
</div>
