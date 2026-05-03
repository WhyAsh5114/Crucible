<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';
	import { CopyButton } from '$lib/components/ai-elements/copy-button';
	import { Badge } from '$lib/components/ui/badge';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';

	interface Props {
		event: Extract<AgentEvent, { type: 'ship_confirmed' }>;
	}

	let { event }: Props = $props();

	// Extract tx hash from explorer URL if available
	const txHash = $derived.by(() => {
		if (!event.explorerUrl) return null;
		const match = event.explorerUrl.match(/\/tx\/(0x[0-9a-fA-F]+)/);
		return match ? match[1] : null;
	});
</script>

<EventFrame label="ship_confirmed" tone="success" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-2.5 rounded-md border border-green-500/20 bg-green-500/5 p-3">
		<div class="flex items-center gap-2">
			<CheckCircleIcon class="size-4 text-green-500" weight="fill" />
			<span class="text-sm font-medium text-green-500">Deployed to Sepolia</span>
			<Badge variant="outline" class="ml-auto font-mono text-[9px]">
				chain {event.chainId}
			</Badge>
		</div>

		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<span class="font-mono text-[10px] text-muted-foreground">contract address</span>
				<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-live">
					{event.contractAddress}
				</code>
				<CopyButton
					text={event.contractAddress}
					size="sm"
					variant="ghost"
					class="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
				/>
			</div>

			{#if txHash}
				<div class="flex flex-wrap items-center gap-2">
					<span class="font-mono text-[10px] text-muted-foreground">tx hash</span>
					<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
						{txHash.slice(0, 14)}…
					</code>
					<CopyButton
						text={txHash}
						size="sm"
						variant="ghost"
						class="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
					/>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a
						href={event.explorerUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="ml-auto font-mono text-[10px] text-muted-foreground/70 underline hover:text-foreground"
					>
						Sepolia Etherscan ↗
					</a>
				</div>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<span class="font-mono text-[10px] text-muted-foreground">audit trail</span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a
					href={`https://app.keeperhub.com/runs/${event.auditTrailId}`}
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono text-[10px] text-primary underline hover:text-primary/80"
				>
					{event.auditTrailId}
				</a>
			</div>
		</div>
	</div>
</EventFrame>
