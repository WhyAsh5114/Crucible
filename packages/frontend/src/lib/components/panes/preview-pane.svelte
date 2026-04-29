<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { WorkspaceState } from '@crucible/types';
	import { createEip1193Bridge } from '$lib/eip1193-bridge';
	import EmptyState from '$lib/components/empty-state.svelte';

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();

	let url = $derived(workspace?.previewUrl ?? null);
	let iframeEl = $state<HTMLIFrameElement | null>(null);

	// Derive only the stable primitives that should trigger bridge recreation.
	// Using the full `workspace` object would cause the bridge to be destroyed
	// and recreated on every poll tick (every 2s), orphaning any in-flight
	// rpc_request promises.
	let workspaceId = $derived(workspace?.id ?? null);
	// Default to Hardhat's well-known chain ID (31337) when chainState hasn't
	// synced yet — the node auto-starts on first eth_requestAccounts so the
	// bridge must be live before chainState is populated.
	let hexChainId = $derived(
		workspace?.chainState?.chainId != null
			? `0x${workspace.chainState.chainId.toString(16)}`
			: '0x7a69'
	);

	let destroyBridge: (() => void) | null = null;

	$effect(() => {
		destroyBridge?.();
		destroyBridge = null;

		if (!iframeEl || !workspaceId) return;

		destroyBridge = createEip1193Bridge(workspaceId, iframeEl, hexChainId);
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
	{:else if !url}
		<EmptyState
			variant="degraded"
			title="Preview not ready"
			description="The workspace runtime hasn't reported a ready preview URL yet. The dev server may still be booting."
		/>
	{:else}
		<iframe
			bind:this={iframeEl}
			src={url}
			title="Workspace preview"
			class="size-full border-0 bg-background"
			sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin"
		></iframe>
	{/if}
</section>
