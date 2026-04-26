<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		icon?: Snippet;
		actions?: Snippet;
		variant?: 'default' | 'degraded';
	}

	let { title, description, icon, actions, variant = 'default' }: Props = $props();
</script>

<div
	class="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center text-muted-foreground"
>
	{#if icon}
		<div class="text-muted-foreground/60">{@render icon()}</div>
	{/if}
	<div class="flex flex-col gap-1">
		<p class="text-sm font-medium text-foreground">
			{#if variant === 'degraded'}
				<span
					class="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase"
				>
					degraded
				</span>
			{/if}
			{title}
		</p>
		{#if description}
			<p class="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex items-center gap-2 pt-1">{@render actions()}</div>
	{/if}
</div>
