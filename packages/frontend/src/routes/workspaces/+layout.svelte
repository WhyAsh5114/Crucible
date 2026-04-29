<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import * as Empty from '$lib/components/ui/empty';

	let { children } = $props();

	const session = authClient.useSession();

	// Auth gate: kick unauth'd visitors to /login. Runs whenever the session
	// resolves to "no user", including the case where a session expires
	// mid-app — the user is moved out of the workspace UI immediately.
	$effect(() => {
		if (!$session.isPending && !$session.data?.user) {
			void goto(resolve('/login'), { replaceState: true });
		}
	});
</script>

{#if $session.data?.user}
	{@render children()}
{:else if $session.isPending}
	<main class="flex min-h-0 flex-1 items-center justify-center p-6">
		<Empty.Root>
			<Empty.Header>
				<Empty.Title>Checking session…</Empty.Title>
			</Empty.Header>
		</Empty.Root>
	</main>
{/if}
