<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import SignInCard from '$lib/components/auth/sign-in-card.svelte';
	import * as Empty from '$lib/components/ui/empty';

	const session = authClient.useSession();

	// If a logged-in user lands on /login, bounce them to the dashboard so the
	// page isn't a dead end with a "you're already signed in" message.
	$effect(() => {
		if ($session.data?.user) void goto(resolve('/workspaces'), { replaceState: true });
	});

	onMount(() => {
		void authClient.getSession();
	});
</script>

<main class="flex min-h-0 flex-1 items-center justify-center p-6">
	{#if $session.isPending}
		<Empty.Root>
			<Empty.Header>
				<Empty.Title>Checking session…</Empty.Title>
			</Empty.Header>
		</Empty.Root>
	{:else if !$session.data?.user}
		<SignInCard callbackURL={resolve('/workspaces')} />
	{/if}
</main>
