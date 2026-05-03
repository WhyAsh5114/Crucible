<script lang="ts">
	/**
	 * Recursive call frame in a transaction trace.
	 *
	 * The trigger row shows the function signature, the truncated `to`
	 * address, and a CALL/REVERT badge. A Tooltip provides the full
	 * address and a longer args preview without forcing the user to
	 * expand. Expanding the row reveals fully-formatted args, return
	 * value (or decoded revert reason), and recursively renders children.
	 *
	 * Reverted frames are styled with `--destructive` accents so the path
	 * that actually failed is obvious at a glance. `Error(string)` revert
	 * payloads are decoded inline; non-standard custom errors fall back to
	 * a properly-wrapped hex code block instead of running off the screen.
	 */
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ArrowBendDownLeftIcon from 'phosphor-svelte/lib/ArrowBendDownLeftIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import { type CallTreeNode, shortAddress, previewArg, decodeErrorString } from './call-tree';
	import Self from './call-node.svelte';

	interface Props {
		node: CallTreeNode;
	}

	let { node }: Props = $props();

	// Default-expand the first 3 levels (depth 0, 1, 2). Deeper subtrees stay
	// collapsed so the initial render of a typical revert trace fits on screen
	// without scrolling. `untrack` because we want this as a one-shot initial
	// value — re-opening a frame the user just collapsed because the parent
	// re-rendered would be confusing.
	let open = $state(untrack(() => node.call.depth < 3));
	const hasChildren = $derived(node.children.length > 0);
	const reverted = $derived(node.call.reverted);
	const argsPreview = $derived(node.call.args.map(previewArg).join(', '));

	// If the result hex is an `Error(string)` ABI payload, decode it back
	// to the human-readable message. Otherwise null and we show the raw
	// hex (still wrapped properly) so the user can at least eyeball it.
	const decodedRevertString = $derived.by<string | null>(() => {
		if (!reverted) return null;
		if (typeof node.call.result !== 'string') return null;
		return decodeErrorString(node.call.result);
	});

	// True when the result hex is the same Error(string) we already decoded —
	// in that case showing both the decoded string AND the raw bytes is
	// duplicative, so we skip the raw view.
	const hasRawResult = $derived(
		typeof node.call.result === 'string' &&
			node.call.result.length > 0 &&
			decodedRevertString === null
	);
</script>

<div
	class={cn(
		'rounded-md border-l-2 transition-colors',
		reverted ? 'border-destructive/60 bg-destructive/5' : 'border-border/60 hover:border-primary/40'
	)}
>
	<Collapsible.Root bind:open>
		<Tooltip.Root>
			<Collapsible.Trigger class="w-full">
				{#snippet child({ props: triggerProps })}
					<Tooltip.Trigger>
						{#snippet child({ props: tipProps })}
							<button
								type="button"
								class="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
								{...triggerProps}
								{...tipProps}
							>
								{#if hasChildren}
									<CaretRightIcon
										class={cn(
											'size-3 shrink-0 text-muted-foreground transition-transform',
											open && 'rotate-90'
										)}
										weight="bold"
									/>
								{:else}
									<span class="size-3 shrink-0" aria-hidden="true"></span>
								{/if}
								<span
									class={cn(
										'shrink-0 rounded px-1 text-[9px] font-semibold tracking-wider uppercase',
										reverted ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary'
									)}
								>
									{reverted ? 'REVERT' : 'CALL'}
								</span>
								<span class="min-w-0 flex-1 truncate text-foreground">
									{node.call.fn}<span class="text-muted-foreground/70">
										({argsPreview || ''})
									</span>
								</span>
								<span class="ml-2 shrink-0 text-muted-foreground/60">
									→ {shortAddress(node.call.to)}
								</span>
							</button>
						{/snippet}
					</Tooltip.Trigger>
				{/snippet}
			</Collapsible.Trigger>

			<Tooltip.Content side="top" align="start" class="max-w-[420px] font-mono text-[10px]">
				<div class="flex flex-col gap-1">
					<div class="flex items-center gap-2">
						<span
							class={cn(
								'rounded px-1 text-[9px] font-semibold tracking-wider uppercase',
								reverted ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary'
							)}
						>
							{reverted ? 'REVERT' : 'CALL'}
						</span>
						<span class="text-foreground">{node.call.fn}</span>
						<span class="text-muted-foreground">depth {node.call.depth}</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-muted-foreground">to</span>
						<code class="break-all text-foreground/80">{node.call.to}</code>
					</div>
					{#if argsPreview}
						<div class="flex flex-col gap-0.5">
							<span class="text-muted-foreground">args</span>
							<code class="break-all text-foreground/80">({argsPreview})</code>
						</div>
					{/if}
					{#if decodedRevertString}
						<div class="flex flex-col gap-0.5">
							<span class="text-muted-foreground">revert</span>
							<code class="break-all text-destructive">{decodedRevertString}</code>
						</div>
					{/if}
				</div>
			</Tooltip.Content>
		</Tooltip.Root>

		<Collapsible.Content>
			<div class="flex flex-col gap-2 px-2 pb-2 pl-7 font-mono text-[10px]">
				{#if node.call.args.length > 0}
					<div class="flex flex-col gap-1">
						<span class="text-muted-foreground">args</span>
						<pre
							class="max-h-32 overflow-auto rounded bg-muted/40 p-1.5 break-all whitespace-pre-wrap text-foreground">{JSON.stringify(
								node.call.args,
								null,
								2
							)}</pre>
					</div>
				{/if}

				{#if reverted}
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-1.5 text-destructive">
							<ArrowBendDownLeftIcon class="size-3 shrink-0" weight="bold" />
							<span class="font-semibold tracking-wide uppercase">reverted</span>
						</div>
						{#if decodedRevertString}
							<div
								class="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 break-words text-destructive"
							>
								{decodedRevertString}
							</div>
						{:else if hasRawResult}
							<!-- Custom-error / unknown revert payload — show the raw bytes
							     wrapped so they don't blow out the layout. The user can
							     copy them into a 4byte-decoder if needed. -->
							<details class="group/raw">
								<summary
									class="cursor-pointer text-muted-foreground/80 select-none hover:text-foreground"
								>
									show raw revert bytes
								</summary>
								<pre
									class="mt-1 max-h-32 overflow-auto rounded bg-destructive/5 p-1.5 break-all whitespace-pre-wrap text-destructive/80">{node
										.call.result as string}</pre>
							</details>
						{/if}
					</div>
				{:else if node.call.result !== null}
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-1.5 text-live">
							<ArrowRightIcon class="size-3 shrink-0" weight="bold" />
							<span class="font-semibold tracking-wide uppercase">return</span>
						</div>
						<pre
							class="max-h-32 overflow-auto rounded bg-muted/40 p-1.5 break-all whitespace-pre-wrap text-foreground">{JSON.stringify(
								node.call.result,
								null,
								2
							)}</pre>
					</div>
				{/if}

				{#if hasChildren}
					<div class="mt-1 flex flex-col gap-1">
						{#each node.children as child, i (i)}
							<Self node={child} />
						{/each}
					</div>
				{/if}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>
