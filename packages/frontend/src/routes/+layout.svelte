<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { setAgentStream, AgentStream } from '$lib/state/agent-stream.svelte';
	import { setWalletStore, WalletStore } from '$lib/state/wallet.svelte';
	import { Toaster } from '$lib/components/ui/sonner';

	let { children } = $props();

	const stream = new AgentStream();
	setAgentStream(stream);

	const wallet = new WalletStore();
	setWalletStore(wallet);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Crucible</title>
</svelte:head>

<div class="dark flex h-svh w-svw flex-col overflow-hidden bg-background font-mono text-foreground">
	{@render children()}
</div>

<Toaster />
