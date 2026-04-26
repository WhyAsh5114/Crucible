<script lang="ts">
	import type { WorkspaceState } from '@crucible/types';
	import EmptyState from '$lib/components/empty-state.svelte';

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();

	let url = $derived(workspace?.previewUrl ?? null);
</script>

<section class="flex h-full min-h-0 flex-col">
	{#if !workspace}
		<EmptyState
			title="No workspace open"
			description="Create or open a workspace to see its live preview."
		/>
	{:else if !url}
		<EmptyState
			variant="degraded"
			title="Preview not ready"
			description="The workspace runtime hasn't reported a ready preview URL yet. The dev server may still be booting."
		/>
	{:else}
		<iframe
			src={url}
			title="Workspace preview"
			class="size-full border-0 bg-background"
			sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin"
		></iframe>
	{/if}
</section>
