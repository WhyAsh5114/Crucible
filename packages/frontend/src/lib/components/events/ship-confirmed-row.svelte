<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'ship_confirmed' }>;
	}

	let { event }: Props = $props();
</script>

<EventFrame label="ship_confirmed" tone="success" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-1.5">
		<div class="flex flex-wrap items-center gap-2">
			<span class="font-mono text-[10px] text-muted-foreground">address</span>
			<code class="rounded bg-muted px-1.5 py-0 font-mono text-[10px] text-live">
				{event.contractAddress}
			</code>
			<a
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				href={event.explorerUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="ml-auto font-mono text-[10px] text-muted-foreground/70 underline hover:text-foreground"
			>
				Sepolia Etherscan ↗
			</a>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<span class="font-mono text-[10px] text-muted-foreground">audit trail</span>
			<a
				href={`https://app.keeperhub.com/runs/${event.auditTrailId}`}
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono text-[10px] text-muted-foreground/70 underline hover:text-foreground"
			>
				{event.auditTrailId.slice(0, 20)}…
			</a>
			<span class="ml-auto font-mono text-[9px] text-muted-foreground/40 tabular-nums"
				>chain {event.chainId}</span
			>
		</div>
	</div>
</EventFrame>
