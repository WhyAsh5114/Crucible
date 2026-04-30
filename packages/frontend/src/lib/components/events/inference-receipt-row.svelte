<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'inference_receipt' }>;
	}

	let { event }: Props = $props();
	const receipt = $derived(event.receipt);
	const isOg = $derived(receipt.provider === '0g-compute');
	const tone = $derived(isOg ? 'success' : 'warn');

	function fallbackLabel(reason: string | null | undefined): string {
		switch (reason) {
			case 'rate_limited':
				return 'Rate limited';
			case 'balance_exhausted':
				return 'Balance exhausted';
			case 'provider_unavailable':
				return 'Provider unavailable';
			case 'admin_override':
				return 'Admin override';
			default:
				return 'Unknown';
		}
	}
</script>

<EventFrame label="inference_receipt" {tone} seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-wrap items-center gap-2 text-xs">
		{#if isOg}
			<span
				class="rounded bg-live/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-live uppercase"
			>
				0G Compute
			</span>
		{:else}
			<span
				class="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400"
			>
				Fallback: {fallbackLabel(receipt.fallbackReason)}
			</span>
		{/if}
		<span class="font-mono text-muted-foreground">{receipt.model}</span>
		<span class="font-mono text-muted-foreground">
			{receipt.promptTokens}↑ {receipt.completionTokens}↓
		</span>
		{#if receipt.attestation}
			<span
				class="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
				title="0G Compute TEE attestation request id"
			>
				attest: {receipt.attestation}
			</span>
		{/if}
	</div>
</EventFrame>
