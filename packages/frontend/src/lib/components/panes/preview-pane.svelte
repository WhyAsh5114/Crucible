<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { WorkspaceState } from '@crucible/types';
	import { createEip1193Bridge } from '$lib/eip1193-bridge';
	import { getWalletStore } from '$lib/state/wallet.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Button } from '$lib/components/ui/button';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';

	interface Props {
		workspace: WorkspaceState | null;
		/**
		 * Triggers a backend preview restart. The page-level state machine
		 * also bumps polling to fast cadence so the new previewUrl arrives
		 * within a couple of seconds. Iframe re-mounts automatically when
		 * the URL or `iframeKey` below changes.
		 */
		onRestart: () => Promise<void> | void;
	}

	let { workspace, onRestart }: Props = $props();
	const wallet = getWalletStore();

	const url = $derived(workspace?.previewUrl ?? null);
	const phase = $derived(workspace?.previewState.phase ?? 'idle');
	const logTail = $derived(workspace?.previewState.logTail ?? []);
	let iframeEl = $state<HTMLIFrameElement | null>(null);

	// Derive only the stable primitives that should trigger bridge recreation.
	// Using the full `workspace` object would cause the bridge to be destroyed
	// and recreated on every poll tick (every 2s), orphaning any in-flight
	// rpc_request promises.
	const workspaceId = $derived(workspace?.id ?? null);
	// Default to Hardhat's well-known chain ID (31337) when chainState hasn't
	// synced yet — the node auto-starts on first eth_requestAccounts so the
	// bridge must be live before chainState is populated.
	const hexChainId = $derived(
		workspace?.chainState?.chainId != null
			? `0x${workspace.chainState.chainId.toString(16)}`
			: '0x7a69'
	);

	// Bumping `reloadNonce` keys the iframe (`{#key}` below) so a click of
	// the refresh button forces a fresh mount even when the URL is identical
	// (e.g. backend reused the same port). Combined with `url` in the key,
	// the iframe remounts on either signal — URL change OR explicit reload.
	let reloadNonce = $state(0);
	let restarting = $state(false);

	async function reloadPreview(): Promise<void> {
		if (restarting) return;
		restarting = true;
		try {
			await onRestart();
			// Bump the nonce so the iframe remounts even if the URL ends up
			// identical — this also forces a clean teardown of the EIP-1193
			// bridge, which can recover from a stuck postMessage handshake.
			reloadNonce += 1;
		} finally {
			restarting = false;
		}
	}

	let destroyBridge: (() => void) | null = null;

	$effect(() => {
		destroyBridge?.();
		destroyBridge = null;

		if (!iframeEl || !workspaceId) return;

		destroyBridge = createEip1193Bridge(workspaceId, iframeEl, hexChainId, wallet);
	});

	onDestroy(() => {
		destroyBridge?.();
	});
</script>

<section class="flex h-full min-h-0 flex-col">
	{#if !workspace}
		<EmptyState
			title="No workspace open"
			description="Create or open a workspace to see its live preview."
		/>
	{:else if phase === 'failed'}
		<EmptyState
			variant="degraded"
			title="Preview crashed"
			description="The dev server failed to start or exited unexpectedly. Check the log below for the underlying error, then try restarting."
		>
			{#snippet actions()}
				<Button size="sm" variant="outline" onclick={reloadPreview} disabled={restarting}>
					{#if restarting}
						<CircleNotchIcon class="size-3.5 animate-spin" weight="bold" data-icon="inline-start" />
					{:else}
						<ArrowClockwiseIcon class="size-3.5" weight="bold" data-icon="inline-start" />
					{/if}
					Retry preview
				</Button>
			{/snippet}
		</EmptyState>
		{#if logTail.length > 0}
			<div
				class="max-h-48 shrink-0 overflow-auto border-t border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
			>
				{#each logTail as line, i (i)}
					<div class="whitespace-pre-wrap">{line}</div>
				{/each}
			</div>
		{/if}
	{:else if !url || phase !== 'ready'}
		<!--
			Single loading state for every non-error transient: backend was
			just hot-reloaded and the in-memory previews map is empty
			(phase='idle', no url — GET /workspace auto-restarts in the
			background), `bun install` is running (phase='installing'),
			Vite is booting (phase='starting'), or there's a brief race
			between setPhase('ready') and the previewUrl landing in the DB.
			Never show a "click to start" CTA for these — the supervisor
			handles them automatically and the user just needs to wait.
		-->
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<CircleNotchIcon class="size-6 animate-spin text-primary" weight="bold" />
			<div class="flex flex-col gap-1">
				<p class="font-mono text-sm text-foreground">
					{#if phase === 'installing'}
						Installing dependencies…
					{:else if phase === 'starting'}
						Starting Vite dev server…
					{:else}
						Loading preview…
					{/if}
				</p>
				<p class="text-xs text-muted-foreground">
					{#if phase === 'installing'}
						First-time bun install can take 30–60 seconds.
					{:else if phase === 'starting'}
						Almost ready — the iframe will appear momentarily.
					{:else}
						Reconnecting to the dev server.
					{/if}
				</p>
			</div>
		</div>
		{#if logTail.length > 0}
			<div
				class="max-h-48 shrink-0 overflow-auto border-t border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
			>
				{#each logTail as line, i (i)}
					<div class="whitespace-pre-wrap">{line}</div>
				{/each}
			</div>
		{/if}
	{:else}
		<header class="flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
			<button
				type="button"
				onclick={reloadPreview}
				disabled={restarting}
				title="Reload preview"
				aria-label="Reload preview"
				class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
			>
				{#if restarting}
					<CircleNotchIcon class="size-3.5 animate-spin" weight="bold" />
				{:else}
					<ArrowClockwiseIcon class="size-3.5" weight="bold" />
				{/if}
			</button>
			<code class="truncate font-mono text-[11px] text-muted-foreground">{url}</code>
		</header>
		{#key `${url}:${reloadNonce}`}
			<iframe
				bind:this={iframeEl}
				src={url}
				title="Workspace preview"
				class="size-full border-0 bg-background"
				sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin"
			></iframe>
		{/key}
	{/if}
</section>
