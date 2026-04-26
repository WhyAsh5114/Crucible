<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspaceClient } from '$lib/api/workspace';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Button } from '$lib/components/ui/button';

	let error = $state<string | null>(null);

	async function bootWorkspace(): Promise<void> {
		error = null;
		try {
			const created = await workspaceClient.createWorkspace({ name: 'Vault demo' });
			await goto(resolve('/workspaces/[id]', { id: created.id }), { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	onMount(() => {
		void bootWorkspace();
	});
</script>

<main class="min-h-0 flex-1">
	{#if error}
		<EmptyState
			variant="degraded"
			title="Failed to start workspace"
			description={error}
		>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={bootWorkspace}>Retry</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<EmptyState
			title="Starting workspace…"
			description="Provisioning a fresh sandbox and runtime container."
		/>
	{/if}
</main>
