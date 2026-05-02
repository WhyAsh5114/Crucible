<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'ship_simulated' }>;
	}

	let { event }: Props = $props();

	function fmtGas(gas: string): string {
		const n = Number(gas);
		if (isNaN(n)) return gas;
		return n.toLocaleString();
	}
</script>

<EventFrame label="ship_simulated" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-2">
		<div class="flex items-center gap-2">
			<span class="font-mono text-[10px] text-muted-foreground">bundle</span>
			<code class="rounded bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground"
				>{event.bundleId.slice(0, 20)}…</code
			>
			{#if event.willSucceed}
				<span
					class="ml-auto rounded-full bg-live/10 px-2 py-0 font-mono text-[9px] tracking-wide text-live uppercase"
					>will succeed</span
				>
			{/if}
		</div>
		<table class="w-full text-[10px]">
			<thead>
				<tr class="text-left text-muted-foreground/60">
					<th class="pr-3 font-normal">contract</th>
					<th class="pr-3 text-right font-normal">gas est.</th>
					<th class="font-normal">note</th>
				</tr>
			</thead>
			<tbody>
				{#each event.gasEstimates as est (est.index)}
					<tr class="border-t border-border/10">
						<td class="py-0.5 pr-3 font-mono">{est.contractName}</td>
						<td class="py-0.5 pr-3 text-right font-mono tabular-nums">{fmtGas(est.gasEstimate)}</td>
						<td class="py-0.5 text-muted-foreground/70">{est.note ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</EventFrame>
