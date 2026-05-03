<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
</script>

<main class="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 p-6">
	<header class="flex flex-col items-center gap-3 text-center">
		<div
			class="flex size-14 items-center justify-center rounded-md bg-primary text-primary-foreground"
		>
			<CubeIcon weight="bold" />
		</div>
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">landing page goes here</h1>
		<p class="max-w-md text-sm text-muted-foreground">
			Crucible is a chat-driven Web3 IDE — agent writes Solidity + frontend, runs a local chain,
			previews live, ships through KeeperHub.
		</p>
	</header>
</main>
