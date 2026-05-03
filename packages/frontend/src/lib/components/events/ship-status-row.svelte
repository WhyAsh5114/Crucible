<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { onDestroy } from 'svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'ship_status' }>;
	}

	let { event }: Props = $props();

	type Status = (typeof event)['status'];

	const toneMap: Record<Status, 'neutral' | 'info' | 'success' | 'warn' | 'destructive'> = {
		pending: 'warn',
		mined: 'info',
		confirmed: 'success'
	};

	const tone = $derived(toneMap[event.status]);

	const statusLabel: Record<Status, string> = {
		pending: 'queued',
		mined: 'mined',
		confirmed: 'confirmed'
	};

	const statusVariant: Record<Status, 'default' | 'secondary' | 'outline' | 'destructive'> = {
		pending: 'secondary',
		mined: 'outline',
		confirmed: 'default'
	};

	let pollInterval: ReturnType<typeof setInterval> | null = null;

	// Note: The backend polls automatically in the background and emits
	// ship_status events via SSE. This component just displays the
	// latest status from the stream. No client-side polling needed.

	onDestroy(() => {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	});
</script>

<EventFrame label="ship_status" {tone} seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-2">
		<div class="flex flex-wrap items-center gap-2">
			<Badge variant={statusVariant[event.status]} class="font-mono text-[10px] uppercase">
				{statusLabel[event.status]}
			</Badge>
			<span class="font-mono text-[10px] text-muted-foreground">execution</span>
			<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
				{event.executionId.slice(0, 20)}…
			</code>
		</div>

		{#if event.txHash}
			<div class="flex flex-wrap items-center gap-2">
				<span class="font-mono text-[10px] text-muted-foreground">tx</span>
				<a
					href={`https://sepolia.etherscan.io/tx/${event.txHash}`}
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono text-[10px] text-muted-foreground/70 underline hover:text-foreground"
				>
					{event.txHash.slice(0, 14)}…
				</a>
				{#if event.blockNumber !== undefined}
					<span class="font-mono text-[10px] text-muted-foreground/50 tabular-nums">
						block {event.blockNumber}
					</span>
				{/if}
			</div>
		{/if}

		{#if event.status === 'confirmed'}
			<div class="flex flex-wrap items-center gap-2">
				<a
					href={`https://app.keeperhub.com/runs/${event.executionId}`}
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono text-[10px] text-primary underline hover:text-primary/80"
				>
					View KeeperHub audit trail →
				</a>
			</div>
		{/if}
	</div>
</EventFrame>
