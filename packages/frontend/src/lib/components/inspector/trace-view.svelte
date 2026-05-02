<script lang="ts">
	/**
	 * Top-level trace summary card + call tree.
	 *
	 * Renders the headline status (success / revert), tx hash, gas used, and
	 * any decoded revert reason at the top, then drops into the recursive
	 * call tree below. Storage reads/writes and emitted events are surfaced
	 * as collapsible footers so the pane stays digestible at a glance.
	 */
	import type { TxTrace } from '@crucible/types';
	import * as Card from '$lib/components/ui/card';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import HashIcon from 'phosphor-svelte/lib/HashIcon';
	import LightningIcon from 'phosphor-svelte/lib/LightningIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CallNode from './call-node.svelte';
	import { buildCallTree, formatNumeric, shortAddress, shortHash } from './call-tree';

	interface Props {
		trace: TxTrace;
	}

	let { trace }: Props = $props();

	const callTree = $derived(buildCallTree(trace.decodedCalls));
	const reverted = $derived(
		trace.revertReason !== undefined || trace.decodedCalls.some((c) => c.reverted)
	);

	let copiedHash = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyHash(): Promise<void> {
		try {
			await navigator.clipboard.writeText(trace.txHash);
			copiedHash = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copiedHash = false), 1500);
		} catch {
			// clipboard API unavailable on some origins; fail silently.
		}
	}
</script>

<Tooltip.Provider delayDuration={150}>
	<div class="flex flex-col gap-3">
		<!-- ── Headline summary card ──────────────────────────────────────────── -->
		<Card.Root class="overflow-hidden">
			<!-- Status strip: green for success, destructive for revert. Pure
		     semantic tokens so the strip follows the active theme. -->
			<div class={reverted ? 'h-1 w-full bg-destructive/70' : 'h-1 w-full bg-live/70'}></div>
			<Card.Header class="pb-3">
				<div class="flex items-start justify-between gap-3">
					<div class="flex flex-col gap-1">
						<Card.Description class="font-mono text-[10px] tracking-wider uppercase">
							Transaction trace
						</Card.Description>
						<div class="flex items-center gap-2">
							{#if reverted}
								<WarningCircleIcon class="size-5 text-destructive" weight="fill" />
								<Card.Title class="font-mono text-sm text-destructive">REVERTED</Card.Title>
							{:else}
								<CheckCircleIcon class="size-5 text-live" weight="fill" />
								<Card.Title class="font-mono text-sm text-live">SUCCESS</Card.Title>
							{/if}
						</div>
					</div>
					<Badge variant="outline" class="gap-1 font-mono text-[10px] text-muted-foreground">
						<LightningIcon class="size-3" weight="fill" />
						{formatNumeric(trace.gasUsed)} gas
					</Badge>
				</div>
			</Card.Header>
			<Separator />
			<Card.Content class="pt-3">
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between gap-2 font-mono text-xs">
						<span class="flex items-center gap-1.5 text-muted-foreground">
							<HashIcon class="size-3" />
							Tx hash
						</span>
						<div class="flex items-center gap-1.5">
							<code class="text-foreground">{shortHash(trace.txHash)}</code>
							<Button
								size="icon"
								variant="ghost"
								onclick={copyHash}
								aria-label="Copy tx hash"
								class="size-6"
							>
								{#if copiedHash}
									<CheckIcon class="size-3 text-live" />
								{:else}
									<CopyIcon class="size-3" />
								{/if}
							</Button>
						</div>
					</div>

					{#if trace.revertReason}
						<div
							class="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2"
						>
							<span class="font-mono text-[10px] tracking-wider text-destructive uppercase">
								Revert reason
							</span>
							<code class="text-xs break-words text-destructive">
								{trace.revertReason}
							</code>
						</div>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>

		<!-- ── Call tree ──────────────────────────────────────────────────────── -->
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between gap-2 px-1">
				<span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
					Call tree ({trace.decodedCalls.length})
				</span>
			</div>
			{#if callTree.length === 0}
				<div
					class="rounded-md border border-border bg-muted/20 p-3 text-center font-mono text-[11px] text-muted-foreground"
				>
					No decoded calls in this trace.
				</div>
			{:else}
				<div class="flex flex-col gap-1">
					{#each callTree as node, i (i)}
						<CallNode {node} />
					{/each}
				</div>
			{/if}
		</div>

		<!-- ── Storage + Events footers (collapsed by default) ────────────────── -->
		{#if trace.storageReads.length > 0 || trace.storageWrites.length > 0}
			<Collapsible.Root>
				<Collapsible.Trigger class="w-full">
					{#snippet child({ props })}
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-left font-mono text-[10px] tracking-wider text-muted-foreground uppercase transition-colors hover:bg-muted/40 focus-visible:outline-none"
							{...props}
						>
							<CaretRightIcon
								class="size-3 transition-transform group-data-[state=open]:rotate-90"
								weight="bold"
							/>
							Storage
							<Badge variant="outline" class="ml-auto font-mono text-[10px] normal-case">
								{trace.storageReads.length} reads · {trace.storageWrites.length} writes
							</Badge>
						</button>
					{/snippet}
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="mt-2 flex flex-col gap-2 rounded-md border border-border p-2">
						{#if trace.storageWrites.length > 0}
							<div class="flex flex-col gap-1">
								<span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
									Writes
								</span>
								{#each trace.storageWrites as w, i (i)}
									<div class="flex items-center gap-2 font-mono text-[10px]">
										<code class="text-muted-foreground">{shortAddress(w.contract)}</code>
										<code class="truncate text-foreground/80">{shortHash(w.slot)}</code>
										<code class="ml-auto truncate text-warning">{shortHash(w.value)}</code>
									</div>
								{/each}
							</div>
						{/if}
						{#if trace.storageReads.length > 0}
							<div class="flex flex-col gap-1">
								<span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
									Reads
								</span>
								{#each trace.storageReads as r, i (i)}
									<div class="flex items-center gap-2 font-mono text-[10px]">
										<code class="text-muted-foreground">{shortAddress(r.contract)}</code>
										<code class="truncate text-foreground/80">{shortHash(r.slot)}</code>
										<code class="ml-auto truncate text-muted-foreground">
											{shortHash(r.value)}
										</code>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}

		{#if trace.events.length > 0}
			<Collapsible.Root>
				<Collapsible.Trigger class="w-full">
					{#snippet child({ props })}
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-left font-mono text-[10px] tracking-wider text-muted-foreground uppercase transition-colors hover:bg-muted/40 focus-visible:outline-none"
							{...props}
						>
							<CaretRightIcon
								class="size-3 transition-transform group-data-[state=open]:rotate-90"
								weight="bold"
							/>
							Events
							<Badge variant="outline" class="ml-auto font-mono text-[10px] normal-case">
								{trace.events.length} emitted
							</Badge>
						</button>
					{/snippet}
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="mt-2 flex flex-col gap-2 rounded-md border border-border p-2">
						{#each trace.events as e, i (i)}
							<div class="flex flex-col gap-1 rounded bg-muted/30 p-2 font-mono text-[10px]">
								<div class="flex items-center justify-between gap-2">
									<code class="text-foreground">{e.name}</code>
									<code class="text-muted-foreground">{shortAddress(e.contract)}</code>
								</div>
								<code class="overflow-x-auto break-all whitespace-pre-wrap text-foreground/80">
									{JSON.stringify(e.args, null, 2)}
								</code>
							</div>
						{/each}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}
	</div>
</Tooltip.Provider>
