<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { setWalletStore, WalletStore } from '$lib/state/wallet.svelte';
	import { setAgentStream, AgentStream } from '$lib/state/agent-stream.svelte';

	let { children } = $props();

	const stream = new AgentStream();
	setAgentStream(stream);

	const wallet = new WalletStore();
	setWalletStore(wallet);
</script>

<svelte:head>
	<title
		>Crucible - Describe a dApp. An agent writes, compiles, deploys, and self-heals it. Live in your
		browser.</title
	>
	<meta
		name="description"
		content="Crucible is a browser-based agentic development environment for Web3. You describe the dApp you want. The agent writes the Solidity and frontend code, compiles it, spins up a local Hardhat chain, deploys, and loads a live interactive preview, all in one unified workspace. "
	/>
</svelte:head>

<ModeWatcher defaultMode="dark" />

<div class="flex h-svh w-svw flex-col overflow-hidden bg-background font-mono text-foreground">
	{@render children()}
</div>

<div class="fixed top-2 right-2 z-50">
	<ModeToggle class="size-8" />
</div>

<Toaster />
