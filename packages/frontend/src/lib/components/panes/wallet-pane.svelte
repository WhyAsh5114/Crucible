<script lang="ts">
	/**
	 * Wallet pane — Crucible's built-in dev wallet for the workspace preview.
	 *
	 * Crucible IS the wallet for the preview iframe: the bridge installs
	 * `window.ethereum` so the dApp talks to us, not MetaMask. This pane
	 * displays the auto-connected Hardhat dev account, its current balance,
	 * and the queue of pending approval requests intercepted by the bridge.
	 * The user clicks Approve / Reject on each request; the bridge resolves
	 * the corresponding promise and either forwards the call to `/rpc` or
	 * returns a `4001 user rejected` error to the dApp.
	 *
	 * Rendering rules:
	 *  - `eth_sendTransaction` shows from / to / value / data fields decoded
	 *    from `params[0]` (a JSON-RPC tx object).
	 *  - `personal_sign` shows the message string (UTF-8 decoded when the
	 *    payload is hex, otherwise raw).
	 *  - `eth_signTypedData_v4` shows the typed-data JSON.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { formatEther, getAddress, hexToString, isHex } from 'viem';
	import type { WorkspaceState } from '@crucible/types';
	import { getWalletStore, type PendingRequest } from '$lib/state/wallet.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import EmptyState from '$lib/components/empty-state.svelte';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import Loader2 from '@lucide/svelte/icons/loader-2';

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

	interface DecodedTx {
		from?: string;
		to?: string;
		value?: string;
		data?: string;
		gas?: string;
	}

	function decodeTx(req: PendingRequest): DecodedTx {
		const raw = req.params[0] as Record<string, unknown> | undefined;
		if (!raw || typeof raw !== 'object') return {};
		const out: DecodedTx = {};
		if (typeof raw.from === 'string') out.from = raw.from;
		if (typeof raw.to === 'string') out.to = raw.to;
		if (typeof raw.value === 'string') {
			try {
				out.value = `${formatEther(BigInt(raw.value))} ETH`;
			} catch {
				out.value = raw.value;
			}
		}
		if (typeof raw.data === 'string' && raw.data !== '0x') out.data = raw.data;
		if (typeof raw.gas === 'string') out.gas = raw.gas;
		return out;
	}

	function decodePersonalSign(req: PendingRequest): string {
		const candidate = req.params[0];
		if (typeof candidate !== 'string') return '(invalid payload)';
		// personal_sign accepts either a hex-encoded string or a plain string.
		if (isHex(candidate)) {
			try {
				return hexToString(candidate);
			} catch {
				return candidate;
			}
		}
		return candidate;
	}

	function decodeTypedData(req: PendingRequest): string {
		const candidate = req.params[1];
		if (typeof candidate === 'string') {
			try {
				return JSON.stringify(JSON.parse(candidate), null, 2);
			} catch {
				return candidate;
			}
		}
		if (candidate && typeof candidate === 'object') {
			return JSON.stringify(candidate, null, 2);
		}
		return '(invalid payload)';
	}

	function methodLabel(method: PendingRequest['method']): string {
		switch (method) {
			case 'eth_sendTransaction':
				return 'Send transaction';
			case 'personal_sign':
				return 'Sign message';
			case 'eth_signTypedData_v4':
				return 'Sign typed data';
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
			<!-- Account card ────────────────────────────────────────────────── -->
			<div class="space-y-3 p-3">
				<Card.Root>
					<Card.Header class="pb-3">
						<Card.Description class="font-mono text-[10px] tracking-wider uppercase">
							Connected account
						</Card.Description>
						<div class="flex items-center justify-between gap-2">
							{#if wallet.account}
								<Card.Title class="font-mono text-sm">
									{shortAddress(getAddress(wallet.account))}
								</Card.Title>
								<Button
									size="icon"
									variant="ghost"
									onclick={handleCopy}
									aria-label="Copy address"
									class="size-7"
								>
									{#if copied}
										<CheckIcon class="size-3.5 text-live" />
									{:else}
										<CopyIcon class="size-3.5" />
									{/if}
								</Button>
							{:else if !chainReady || wallet.refreshing || wallet.failedAttempts < 3}
								<!-- Stay in "Connecting…" while the page-level retry loop is still
								     working through its budget (configured to ~6 attempts with
								     backoff). Showing the destructive error UI on the first failed
								     refresh causes a visible flicker during the chain warmup window
								     where the rpc proxy briefly 503s. -->
								<Card.Title class="flex items-center gap-2 font-mono text-sm text-muted-foreground">
									<Loader2 class="size-3.5 animate-spin" />
									{chainReady ? 'Connecting…' : 'Booting chain…'}
								</Card.Title>
							{:else}
								<div class="space-y-2">
									<Card.Title class="font-mono text-sm text-destructive">
										Couldn't load dev account
									</Card.Title>
									<p class="text-xs text-muted-foreground">
										{wallet.lastError ??
											'The chain reported ready but eth_accounts returned nothing.'}
									</p>
									<Button
										size="sm"
										variant="outline"
										onclick={() => void wallet.refresh()}
										class="mt-1"
									>
										Retry
									</Button>
								</div>
							{/if}
						</div>
					</Card.Header>
					<Card.Content class="pt-0">
						<div class="space-y-1">
							<div class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
								Balance
							</div>
							<div class="font-mono text-2xl font-semibold text-foreground tabular-nums">
								{#if wallet.balanceEth !== null}
									{wallet.balanceEth} <span class="text-base text-muted-foreground">ETH</span>
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</div>
							<div class="font-mono text-[10px] text-muted-foreground">
								{chainIdLabel(wallet.chainId)}
							</div>
						</div>
					</Card.Content>
				</Card.Root>

				<!-- Pending request queue ──────────────────────────────────── -->
				{#if wallet.pending.length === 0}
					<div class="flex flex-col items-center gap-2 px-2 py-8 text-center">
						<div class="font-mono text-[10px] tracking-wider text-muted-foreground/60 uppercase">
							No pending requests
						</div>
						<p class="text-xs text-muted-foreground/80">
							Sign and transaction requests from the preview will appear here.
						</p>
					</div>
				{:else}
					<div class="space-y-2">
						<div class="space-y-1 px-1">
							<div class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
								Pending ({wallet.pending.length})
							</div>
							<p class="text-xs text-muted-foreground">
								Approve to forward the request to the local Hardhat node.
							</p>
						</div>
						{#each wallet.pending as req (req.id)}
							<Card.Root class="border-warning/40 bg-warning/5">
								<Card.Header class="pb-3">
									<div class="flex items-center justify-between gap-2">
										<Card.Title class="font-mono text-xs">{methodLabel(req.method)}</Card.Title>
										<Badge variant="outline" class="font-mono text-[10px]">
											{new URL(req.origin).host}
										</Badge>
									</div>
								</Card.Header>
								<Card.Content class="space-y-3 pt-0">
									{#if req.method === 'eth_sendTransaction'}
										{@const tx = decodeTx(req)}
										<dl class="space-y-2 font-mono text-[11px]">
											{#if tx.from}
												<div class="flex items-center justify-between gap-2">
													<dt class="text-muted-foreground">From</dt>
													<dd class="break-all text-foreground">{shortAddress(tx.from)}</dd>
												</div>
											{/if}
											{#if tx.to}
												<div class="flex items-center justify-between gap-2">
													<dt class="text-muted-foreground">To</dt>
													<dd class="break-all text-foreground">{shortAddress(tx.to)}</dd>
												</div>
											{/if}
											<div class="flex items-center justify-between gap-2">
												<dt class="text-muted-foreground">Value</dt>
												<dd class="text-foreground">{tx.value ?? '0 ETH'}</dd>
											</div>
											{#if tx.gas}
												<div class="flex items-center justify-between gap-2">
													<dt class="text-muted-foreground">Gas limit</dt>
													<dd class="text-foreground">
														{Number.parseInt(tx.gas, 16).toLocaleString()}
													</dd>
												</div>
											{/if}
											{#if tx.data}
												<Separator />
												<div class="space-y-1">
													<dt class="text-muted-foreground">Data</dt>
													<dd
														class="max-h-24 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 break-all"
													>
														{tx.data}
													</dd>
												</div>
											{/if}
										</dl>
									{:else if req.method === 'personal_sign'}
										<div class="space-y-1 font-mono text-[11px]">
											<div class="text-muted-foreground">Message</div>
											<pre
												class="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 whitespace-pre-wrap text-foreground">{decodePersonalSign(
													req
												)}</pre>
										</div>
									{:else}
										<div class="space-y-1 font-mono text-[11px]">
											<div class="text-muted-foreground">Typed data</div>
											<pre
												class="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 whitespace-pre-wrap text-foreground">{decodeTypedData(
													req
												)}</pre>
										</div>
									{/if}

									<div class="flex items-center gap-2 pt-1">
										<Button
											variant="default"
											size="sm"
											class="flex-1"
											onclick={() => wallet.approve(req.id)}
										>
											Approve
										</Button>
										<Button
											variant="outline"
											size="sm"
											class="flex-1"
											onclick={() => wallet.reject(req.id)}
										>
											Reject
										</Button>
									</div>
								</Card.Content>
							</Card.Root>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</section>
