<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { setAgentStream, AgentStream } from '$lib/state/agent-stream.svelte';
	import { env } from '$env/dynamic/public';

	let { children } = $props();

	const fixtureMode = (env.PUBLIC_USE_FIXTURES ?? 'true') !== 'false';
	const stream = new AgentStream({ mode: fixtureMode ? 'fixture' : 'live' });
	setAgentStream(stream);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Crucible</title>
</svelte:head>

<div class="dark flex h-svh w-svw flex-col overflow-hidden bg-background font-mono text-foreground">
	{@render children()}
</div>
