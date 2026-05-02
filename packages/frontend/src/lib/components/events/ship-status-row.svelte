<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'ship_status' }>;
	}

	let { event }: Props = $props();

	type Status = (typeof event)['status'];

	const toneMap: Record<Status, 'neutral' | 'info' | 'success' | 'warn' | 'destructive'> = {
		pending: 'neutral',
		mined: 'info',
		confirmed: 'success'
	};

	const tone = $derived(toneMap[event.status]);

	const statusLabel: Record<Status, string> = {
		pending: 'pending',
		mined: 'mined',
		confirmed: 'confirmed'
	};

	const statusColor: Record<Status, string> = {
		pending: 'text-muted-foreground',
		mined: 'text-foreground',
		confirmed: 'text-live'
	};
</script>

<EventFrame label="ship_status" {tone} seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-wrap items-center gap-3">
		<span class="font-mono text-[10px] text-muted-foreground">execution</span>
		<code class="rounded bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground"
			>{event.executionId.slice(0, 20)}…</code
		>
		<span class={`font-mono text-[10px] tracking-wide uppercase ${statusColor[event.status]}`}>
			{statusLabel[event.status]}
		</span>
		{#if event.txHash}
			<a
				href={`https://sepolia.etherscan.io/tx/${event.txHash}`}
				target="_blank"
				rel="noopener noreferrer"
				class="ml-auto font-mono text-[10px] text-muted-foreground/70 underline hover:text-foreground"
			>
				{event.txHash.slice(0, 14)}…
			</a>
		{/if}
		{#if event.blockNumber !== undefined}
			<span class="font-mono text-[10px] text-muted-foreground/50 tabular-nums"
				>block {event.blockNumber}</span
			>
		{/if}
	</div>
</EventFrame>
