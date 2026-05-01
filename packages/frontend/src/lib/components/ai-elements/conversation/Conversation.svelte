<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import type { StickToBottomContext } from './stick-to-bottom-context.svelte.js';

	export interface ConversationProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		children?: Snippet;
		initial?: ScrollBehavior;
		resize?: ScrollBehavior;
		/**
		 * Bindable handle to the stick-to-bottom controller. Lets parents
		 * trigger `scrollToBottom()` from outside the conversation tree —
		 * e.g. when a new prompt is submitted, so the user follows the
		 * incoming agent stream even if they had scrolled up to read prior
		 * output.
		 */
		stick?: StickToBottomContext;
	}
</script>

<script lang="ts">
	import { setStickToBottomContext } from './stick-to-bottom-context.svelte.js';

	let {
		class: className,
		children,
		initial = 'smooth',
		resize = 'smooth',
		ref = $bindable(null),
		stick = $bindable(),
		...restProps
	}: ConversationProps = $props();

	let context = setStickToBottomContext();
	stick = context;
</script>

<div
	bind:this={ref}
	class={cn('relative flex h-full flex-col overflow-hidden', className)}
	role="log"
	{...restProps}
>
	{@render children?.()}
</div>
