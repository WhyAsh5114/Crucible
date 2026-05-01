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

	let { label, tone = 'neutral', emittedAt, children }: Props = $props();

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
	class="group flex flex-col gap-0.5 border-b border-border/40 px-3 py-1.5 transition-colors hover:bg-muted/20"
>
	<header
		class="flex items-center gap-1.5 text-[9px] font-medium tracking-wide text-muted-foreground/70 uppercase"
	>
		<span class={cn('font-mono', toneClass[tone])}>{label}</span>
		<span class="ml-auto font-mono tabular-nums opacity-60">{fmt(emittedAt)}</span>
	</header>
	<div class="text-xs leading-normal text-foreground">
		{@render children()}
	</div>
</article>
