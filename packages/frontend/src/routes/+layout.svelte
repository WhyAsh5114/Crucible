<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { setAgentStream, AgentStream } from '$lib/state/agent-stream.svelte';

	let { children } = $props();

	const stream = new AgentStream();
	setAgentStream(stream);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Crucible</title>
</svelte:head>

<div class="dark flex h-svh w-svw flex-col overflow-hidden bg-background font-mono text-foreground">
	{@render children()}
</div>
