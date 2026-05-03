<script lang="ts">
	/**
	 * Transaction trace inspector pane.
	 *
	 * Surfaces the most recent transaction trace observed on the agent stream
	 * so the user can see what actually happened on-chain — call tree,
	 * storage writes, emitted events, and (for failures) the decoded revert
	 * reason. Without this pane the only visible signal of a deploy is the
	 * agent's chat text, which is opaque about the underlying EVM behaviour.
	 *
	 * Source of truth: we walk `stream.events` ourselves (NOT via the
	 * `pairToolEvents` helper) so the inspector survives SSE reconnects
	 * where a `tool_result` lands without its preceding `tool_call`. Two
	 * signals are accepted, in priority order:
	 *
	 *   1. `trace_captured` — the agent's repair loop emits this with a
	 *      pre-decoded `TxTrace` ready to render. Highest priority.
	 *
	 *   2. A `tool_result` for a `deployer.trace` call, when the agent
	 *      invoked `trace` directly (outside the repair loop). The MCP raw
	 *      output is decoded back into a `TxTrace` via the schema.
	 *
	 * Phase 1: only the most recent trace is shown — no history list. The
	 * `mode` prop is reserved for a future Phase 4 KeeperHub/public-chain
	 * variant; for now it's effectively a no-op tag the page passes through.
	 *
	 * Phase 4 (Ship): When a ship_confirmed event is present, show a
	 * "Deployed to Sepolia" section alongside the trace section.
	 */
	import { TxTraceSchema, type TxTrace, type AgentEvent } from '@crucible/types';
	import { SvelteMap } from 'svelte/reactivity';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { CopyButton } from '$lib/components/ai-elements/copy-button';
	import TraceView from './trace-view.svelte';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import RocketLaunchIcon from 'phosphor-svelte/lib/RocketLaunchIcon';

	// Phase 1 takes no props. Phase 4 will add `mode: 'local' | 'keeperhub'`
	// here to switch the pane into a public-chain variant with explorer
	// links. Intentionally not declaring the Props interface yet — adding it
	// would force every call site to spell `<InspectorPane mode="local" />`
	// for no current benefit.

	const stream = getAgentStream();

	/**
	 * Pull the structured `TxTrace` out of a `deployer.trace` MCP tool_result.
	 * MCP can return either `structuredContent` (already parsed) or a JSON
	 * string in `content[].text` (fallback path). We probe both.
	 */
	function extractTraceFromMcpResult(raw: unknown): TxTrace | null {
		if (!raw || typeof raw !== 'object') return null;
		const obj = raw as {
			structuredContent?: unknown;
			content?: Array<{ type?: string; text?: string }>;
		};
		// 1. Structured content — preferred when available.
		if (obj.structuredContent) {
			const parsed = TxTraceSchema.safeParse(obj.structuredContent);
			if (parsed.success) return parsed.data;
		}
		// 2. Text content fallback — try parsing the first text frame as JSON.
		const text = obj.content?.find((c) => c.type === 'text')?.text;
		if (typeof text === 'string' && text.length > 0) {
			try {
				const decoded = JSON.parse(text) as unknown;
				const parsed = TxTraceSchema.safeParse(decoded);
				if (parsed.success) return parsed.data;
			} catch {
				// Not JSON — give up.
			}
		}
		return null;
	}

	/**
	 * Walk the event log in reverse to find the most recent trace. Reading
	 * the raw event array (not paired ChatItems) means we still see a
	 * `tool_result` whose matching `tool_call` was lost across an SSE
	 * reconnect — which is exactly the situation a user is most likely to
	 * need the inspector for.
	 */
	const trace = $derived.by<TxTrace | null>(() => {
		const events = stream.events;
		// Index tool_call by callId so we can look up the tool name when we
		// hit a tool_result. Built lazily on the first tool_result we see.
		let callIndex: SvelteMap<string, Extract<AgentEvent, { type: 'tool_call' }>> | null = null;

		for (let i = events.length - 1; i >= 0; i--) {
			const ev = events[i]!;
			if (ev.type === 'trace_captured') return ev.trace;
			if (ev.type === 'tool_result' && ev.outcome.ok) {
				if (callIndex === null) {
					callIndex = new SvelteMap();
					for (const e of events) {
						if (e.type === 'tool_call') callIndex.set(e.callId, e);
					}
				}
				const call = callIndex.get(ev.callId);
				if (call && call.tool === 'deployer.trace') {
					const extracted = extractTraceFromMcpResult(ev.outcome.result);
					if (extracted) return extracted;
				}
			}
		}
		return null;
	});

	// `revert_detected` is a "trace incoming" signal — the agent has detected
	// a revert and the matching trace_captured should land within seconds. We
	// surface this as a loading hint while we wait, so the user isn't staring
	// at an empty pane during the gap.
	const pendingRevert = $derived.by<{ txHash: string; signature: string } | null>(() => {
		const events = stream.events;
		for (let i = events.length - 1; i >= 0; i--) {
			const ev = events[i]!;
			if (ev.type === 'trace_captured') return null; // trace already arrived
			if (ev.type === 'revert_detected') {
				return { txHash: ev.txHash, signature: ev.revertSignature };
			}
		}
		return null;
	});

	/**
	 * Find the most recent ship_confirmed event in the stream.
	 * Returns null when no ship deployment has been confirmed.
	 */
	const shipDeployment = $derived.by<Extract<AgentEvent, { type: 'ship_confirmed' }> | null>(() => {
		const events = stream.events;
		for (let i = events.length - 1; i >= 0; i--) {
			const ev = events[i]!;
			if (ev.type === 'ship_confirmed') {
				return ev;
			}
		}
		return null;
	});

	// Extract tx hash from explorer URL
	const shipTxHash = $derived.by(() => {
		if (!shipDeployment?.explorerUrl) return null;
		const match = shipDeployment.explorerUrl.match(/\/tx\/(0x[0-9a-fA-F]+)/);
		return match ? match[1] : null;
	});

	// Estimate gas used (placeholder since backend doesn't provide it yet)
	const gasUsed = $derived('N/A');
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	<header
		class="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3"
	>
		<div class="flex items-center gap-2">
			<MagnifyingGlassIcon class="size-4 text-muted-foreground" weight="bold" />
			<h2 class="text-sm font-medium tracking-tight text-foreground">Inspector</h2>
		</div>
		{#if trace}
			<Badge variant="outline" class="font-mono text-[10px]">
				{trace.decodedCalls.length} call{trace.decodedCalls.length === 1 ? '' : 's'}
			</Badge>
		{/if}
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- Ship deployment section -->
		{#if shipDeployment}
			<div class="border-b border-border/40 bg-green-500/5 p-3">
				<div class="mb-3 flex items-center gap-2">
					<RocketLaunchIcon class="size-4 text-green-500" weight="fill" />
					<h3 class="text-sm font-medium text-green-500">Deployed to Sepolia</h3>
					<Badge variant="outline" class="ml-auto font-mono text-[9px]">
						chain {shipDeployment.chainId}
					</Badge>
				</div>

				<div class="flex flex-col gap-2 text-xs">
					<div class="flex items-center gap-2">
						<span class="w-20 font-mono text-[10px] text-muted-foreground">Contract</span>
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-live">
							{shipDeployment.contractAddress}
						</code>
						<CopyButton
							text={shipDeployment.contractAddress}
							size="sm"
							variant="ghost"
							class="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
						/>
					</div>

					{#if shipTxHash}
						<div class="flex items-center gap-2">
							<span class="w-20 font-mono text-[10px] text-muted-foreground">Tx Hash</span>
							<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
								{shipTxHash.slice(0, 14)}…
							</code>
							<CopyButton
								text={shipTxHash}
								size="sm"
								variant="ghost"
								class="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
							/>
							<a
								href={shipDeployment.explorerUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="ml-auto font-mono text-[10px] text-muted-foreground/70 underline hover:text-foreground"
							>
								Etherscan ↗
							</a>
						</div>
					{/if}

					<div class="flex items-center gap-2">
						<span class="w-20 font-mono text-[10px] text-muted-foreground">Gas Used</span>
						<span class="font-mono text-[10px] text-foreground">{gasUsed}</span>
					</div>

					<div class="flex items-center gap-2">
						<span class="w-20 font-mono text-[10px] text-muted-foreground">Audit Trail</span>
						<a
							href={`https://app.keeperhub.com/runs/${shipDeployment.auditTrailId}`}
							target="_blank"
							rel="noopener noreferrer"
							class="font-mono text-[10px] text-primary underline hover:text-primary/80"
						>
							{shipDeployment.auditTrailId}
						</a>
					</div>
				</div>
			</div>
		{/if}

		<!-- Trace section -->
		{#if trace}
			<div class="p-3">
				<TraceView {trace} />
			</div>
		{:else if pendingRevert}
			<EmptyState
				variant="degraded"
				title="Revert detected — capturing trace…"
				description="The agent caught a revert. The decoded call tree will appear here in a moment."
			/>
		{:else if !shipDeployment}
			<EmptyState
				title="No trace captured yet"
				description="Deploy a contract or call a transaction. If it reverts, the call tree and decoded revert reason will land here automatically."
			/>
		{/if}
	</div>
</section>
