<script lang="ts">
	/**
	 * Wallet pane — Crucible's built-in dev wallet for the workspace preview.
	 *
	 * Crucible IS the wallet for the preview iframe: the bridge installs
	 * `window.ethereum` so the dApp talks to us, not MetaMask. This pane
	 * displays the auto-connected Hardhat dev account and its current
	 * balance.
	 *
	 * Pending approval requests (eth_sendTransaction / personal_sign /
	 * eth_signTypedData_v4) are NOT rendered here — they surface as a
	 * centered Dialog via `wallet-approval-dialog.svelte` mounted at the
	 * IDE layout level so the user can approve in place without leaving
	 * whatever pane they were on.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { getAddress } from 'viem';
	import type { WorkspaceState } from '@crucible/types';
	import { getWalletStore } from '$lib/state/wallet.svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import EmptyState from '$lib/components/empty-state.svelte';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import LinkIcon from '@lucide/svelte/icons/link';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import HashIcon from '@lucide/svelte/icons/hash';
	import ZapIcon from '@lucide/svelte/icons/zap';

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();
	const wallet = getWalletStore();

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	let workspaceId = $derived(workspace?.id ?? null);
	// Only attempt RPC once the chain reports a chainId — otherwise `eth_accounts`
	// races the Hardhat boot and the rpc proxy answers 503 every 2s while polling.
	let chainReady = $derived(workspace?.chainState != null);

	// `setWorkspace` is also called from the workspace page on load, so when
	// this pane first mounts the store is already bound. We re-bind here to
	// stay correct if the user navigates between workspaces while this pane
	// is mounted. The page-level effect is the primary refresher; this is a
	// best-effort top-up when the user opens the wallet tab after the chain
	// just came up.
	$effect(() => {
		const id = workspaceId;
		if (!id) return;
		wallet.setWorkspace(id);
		if (chainReady && !wallet.account && !wallet.refreshing) void wallet.refresh();
	});

	onMount(() => {
		// Re-check balance every 10s so the panel stays roughly fresh even when
		// the user isn't actively triggering txs (e.g. agent-driven deploy).
		const interval = setInterval(() => {
			if (wallet.account) void wallet.refreshBalance();
		}, 10_000);
		return () => clearInterval(interval);
	});

	onDestroy(() => {
		if (copyTimer) clearTimeout(copyTimer);
	});

	function shortAddress(addr: string): string {
		return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
	}

	function chainIdLabel(hex: string | null): string {
		if (!hex) return '—';
		const n = Number.parseInt(hex, 16);
		if (n === 31337) return 'Hardhat (31337)';
		return `Chain ${n}`;
	}

	async function handleCopy(): Promise<void> {
		if (!wallet.account) return;
		try {
			await navigator.clipboard.writeText(getAddress(wallet.account));
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// clipboard API may be unavailable on some origins; fail silently.
		}
	}

</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	<header
		class="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3"
	>
		<div class="flex items-center gap-2">
			<WalletIcon class="size-4 text-muted-foreground" />
			<h2 class="text-sm font-medium tracking-tight text-foreground">Wallet</h2>
		</div>
		<div class="flex items-center gap-2">
			{#if wallet.pending.length > 0}
				<Badge variant="destructive" class="font-mono text-[10px]">
					{wallet.pending.length} pending
				</Badge>
			{/if}
			<Button
				size="icon"
				variant="ghost"
				onclick={() => void wallet.refresh()}
				disabled={wallet.loadingBalance}
				aria-label="Refresh wallet"
				class="size-7"
			>
				<RefreshIcon class={wallet.loadingBalance ? 'size-3.5 animate-spin' : 'size-3.5'} />
			</Button>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !workspace}
			<EmptyState
				title="No workspace open"
				description="Open a workspace to connect to its local dev wallet."
			/>
		{:else}
			<div class="flex flex-col gap-3 p-3">
				<!-- ── Hero account card ─────────────────────────────────────── -->
				<Card.Root class="overflow-hidden">
					{#if wallet.account}
						{@const addr = getAddress(wallet.account)}
						<!--
							Decorative gradient strip uses --primary and --live so it
							adapts to the current theme. Sits above the avatar to give
							the card identity without raw colors.
						-->
						<div class="h-12 w-full bg-gradient-to-r from-primary/40 via-primary/10 to-live/30"></div>
						<Card.Header class="-mt-6 pb-3">
							<div class="flex items-end justify-between gap-3">
								<Avatar.Root class="size-12 ring-2 ring-background">
									<!--
										Vercel's avatar service generates a deterministic
										geometric pattern from any seed. Same pattern the
										workspace sidebar uses for users — consistent treatment
										across the IDE.
									-->
									<Avatar.Image
										src="https://avatar.vercel.sh/{encodeURIComponent(addr)}"
										alt="Account avatar"
									/>
									<Avatar.Fallback class="font-mono text-[10px]">
										{addr.slice(2, 4).toUpperCase()}
									</Avatar.Fallback>
								</Avatar.Root>
								<Badge variant="outline" class="gap-1.5 border-live/40 font-mono text-[10px] text-live">
									<span
										class="size-1.5 rounded-full bg-live shadow-[0_0_6px_var(--live)]"
										aria-hidden="true"
									></span>
									ACTIVE
								</Badge>
							</div>
							<div class="mt-2 flex items-center justify-between gap-2">
								<div class="flex flex-col gap-0.5">
									<Card.Description class="font-mono text-[10px] tracking-wider uppercase">
										Dev account
									</Card.Description>
									<Card.Title class="font-mono text-sm">{shortAddress(addr)}</Card.Title>
								</div>
								<Button
									size="icon"
									variant="ghost"
									onclick={handleCopy}
									aria-label="Copy address"
									class="size-8"
								>
									{#if copied}
										<CheckIcon class="size-3.5 text-live" />
									{:else}
										<CopyIcon class="size-3.5" />
									{/if}
								</Button>
							</div>
						</Card.Header>
						<Separator />
						<Card.Content class="pt-3">
							<div class="flex flex-col gap-1">
								<div class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
									Balance
								</div>
								<div class="font-mono text-2xl font-semibold text-foreground tabular-nums">
									{#if wallet.balanceEth !== null}
										{wallet.balanceEth}
										<span class="text-base text-muted-foreground">ETH</span>
									{:else if wallet.loadingBalance}
										<Loader2 class="inline size-5 animate-spin text-muted-foreground" />
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</div>
								<p class="font-mono text-[10px] text-muted-foreground/70">
									Pre-funded by Hardhat · 10000 ETH at genesis
								</p>
							</div>
						</Card.Content>
					{:else if !chainReady || wallet.refreshing || wallet.failedAttempts < 3}
						<!-- Stay in "Connecting…" while the page-level retry loop is
						     still working through its budget. -->
						<Card.Header>
							<Card.Title class="flex items-center gap-2 font-mono text-sm text-muted-foreground">
								<Loader2 class="size-3.5 animate-spin" />
								{chainReady ? 'Connecting to chain…' : 'Booting Hardhat node…'}
							</Card.Title>
							<Card.Description>
								The dev wallet auto-attaches to the workspace's local chain on first boot.
							</Card.Description>
						</Card.Header>
					{:else}
						<Card.Header>
							<Card.Title class="font-mono text-sm text-destructive">
								Couldn't load dev account
							</Card.Title>
							<Card.Description>
								{wallet.lastError ?? 'The chain reported ready but eth_accounts returned nothing.'}
							</Card.Description>
						</Card.Header>
						<Card.Content>
							<Button size="sm" variant="outline" onclick={() => void wallet.refresh()}>
								<RefreshIcon class="size-3.5" data-icon="inline-start" />
								Retry
							</Button>
						</Card.Content>
					{/if}
				</Card.Root>

				<!-- ── Network card ──────────────────────────────────────────── -->
				{#if wallet.account}
					<Card.Root>
						<Card.Header class="pb-2">
							<Card.Description
								class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase"
							>
								<LinkIcon class="size-3" />
								Network
							</Card.Description>
						</Card.Header>
						<Card.Content class="flex flex-col gap-2 pt-0">
							<div class="flex items-center justify-between gap-2 font-mono text-xs">
								<span class="flex items-center gap-1.5 text-muted-foreground">
									<LayersIcon class="size-3" />
									Chain
								</span>
								<span class="text-foreground">{chainIdLabel(wallet.chainId)}</span>
							</div>
							<div class="flex items-center justify-between gap-2 font-mono text-xs">
								<span class="flex items-center gap-1.5 text-muted-foreground">
									<HashIcon class="size-3" />
									Block height
								</span>
								<span class="text-foreground tabular-nums">
									{#if workspace.chainState}
										{workspace.chainState.blockNumber.toLocaleString()}
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</span>
							</div>
							<div class="flex items-center justify-between gap-2 font-mono text-xs">
								<span class="flex items-center gap-1.5 text-muted-foreground">
									<ZapIcon class="size-3" />
									RPC
								</span>
								<span class="truncate text-foreground/80">via Crucible bridge</span>
							</div>
						</Card.Content>
					</Card.Root>
				{/if}

				<!-- ── Approval-flow note ────────────────────────────────────── -->
				<div
					class="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground"
				>
					<WalletIcon class="size-3.5 shrink-0 text-primary" />
					<p class="leading-relaxed">
						Sign and transaction requests from the preview appear as a popup so you can review and
						approve them in place — no need to switch tabs.
					</p>
				</div>
			</div>
		{/if}
	</div>
</section>
