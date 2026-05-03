<script lang="ts">
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

<ModeWatcher defaultMode="dark" />

<div class="flex h-svh w-svw flex-col overflow-hidden bg-background font-mono text-foreground">
	{@render children()}
</div>

<div class="fixed top-2 right-2 z-50">
	<ModeToggle class="size-8" />
</div>

<Toaster />
