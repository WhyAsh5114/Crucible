<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		label: string;
		tone?: 'neutral' | 'info' | 'success' | 'warn' | 'destructive';
		seq?: number;
		emittedAt?: number;
		children: Snippet;
	}

	let { label, tone = 'neutral', seq, emittedAt, children }: Props = $props();

	const toneClass: Record<NonNullable<Props['tone']>, string> = {
		neutral: 'text-muted-foreground',
		info: 'text-foreground',
		success: 'text-live',
		warn: 'text-foreground',
		destructive: 'text-destructive'
	};

	function fmt(ts: number | undefined): string {
		if (!ts) return '';
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour12: false });
	}
</script>

<article
	class="group flex flex-col gap-1.5 border-b border-border/60 px-4 py-3 transition-colors hover:bg-muted/30"
>
	<header
		class="flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
	>
		<span class={cn('font-mono', toneClass[tone])}>{label}</span>
		{#if typeof seq === 'number'}
			<span class="font-mono text-muted-foreground/60">#{seq}</span>
		{/if}
		<span class="ml-auto font-mono tabular-nums">{fmt(emittedAt)}</span>
	</header>
	<div class="text-sm leading-relaxed text-foreground">
		{@render children()}
	</div>
</article>
