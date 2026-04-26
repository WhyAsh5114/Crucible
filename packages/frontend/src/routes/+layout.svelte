<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { setAgentStream, AgentStream } from '$lib/state/agent-stream.svelte';
	import { authClient } from '$lib/auth-client';

	let { children } = $props();

	const stream = new AgentStream();
	setAgentStream(stream);

	onMount(async () => {
		const session = await authClient.getSession();
		if (!session.data?.session) {
			await authClient.signIn.anonymous();
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Crucible</title>
</svelte:head>

<div class="dark flex h-svh w-svw flex-col overflow-hidden bg-background font-mono text-foreground">
	{@render children()}
</div>
