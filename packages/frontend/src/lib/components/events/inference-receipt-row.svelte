<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'inference_receipt' }>;
	}

	let { event }: Props = $props();
	const receipt = $derived(event.receipt);
	const isOg = $derived(receipt.provider === '0g-compute');
	const tone = $derived(isOg && !receipt.fallbackReason ? 'success' : 'warn');

	/** Decoded `x_0g_trace` for 0G turns; null when unavailable or malformed. */
	type OgTrace = {
		request_id?: string;
		provider?: string;
		billing?: { input_cost?: string; output_cost?: string; total_cost?: string };
		tee_verified?: unknown;
	};
	const trace = $derived.by((): OgTrace | null => {
		if (!receipt.attestation) return null;
		try {
			return JSON.parse(receipt.attestation) as OgTrace;
		} catch {
			return null;
		}
	});
	const teeVerified = $derived(Boolean(trace?.tee_verified));

	let expanded = $state(false);

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
		{#if isOg && !receipt.fallbackReason}
			<span
				class="rounded bg-live/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-live uppercase"
			>
				0G Compute
			</span>
		{:else if isOg && receipt.fallbackReason}
			<span
				class="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400"
				title="0G Compute Router error — turn did not complete"
			>
				0G Compute · {fallbackLabel(receipt.fallbackReason)}
			</span>
		{:else}
			<span
				class="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400"
			>
				Fallback: {fallbackLabel(receipt.fallbackReason)}
			</span>
		{/if}
		{#if teeVerified}
			<span
				class="rounded bg-live/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-live uppercase"
				title="Provider returned a TEE attestation proof for this response"
			>
				TEE verified
			</span>
		{/if}
		<span class="font-mono text-muted-foreground">{receipt.model}</span>
		<span class="font-mono text-muted-foreground">
			{receipt.promptTokens}↑ {receipt.completionTokens}↓
		</span>
		{#if trace?.request_id}
			<button
				type="button"
				onclick={() => (expanded = !expanded)}
				class="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/40 focus:ring-1 focus:ring-ring focus:outline-none"
				title="Click to {expanded ? 'hide' : 'show'} the full x_0g_trace"
				aria-expanded={expanded}
			>
				attest: {trace.request_id}
			</button>
		{/if}
	</div>
	{#if expanded && receipt.attestation}
		<pre
			class="mt-2 max-h-64 overflow-auto rounded border border-border bg-muted/30 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(
				trace,
				null,
				2
			)}</pre>
	{/if}
</EventFrame>
