<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { WorkspaceState } from '@crucible/types';
	import EmptyState from '$lib/components/empty-state.svelte';

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let term: { destroy(): void; write(data: string): void } | null = null;

	let sessionId = $derived(workspace?.terminalSessionId ?? null);

	onMount(async () => {
		if (!host || !sessionId) return;

		const { WTerm } = await import('@wterm/dom');

		const wt = new WTerm(host, {
			cols: 100,
			rows: 24,
			cursorBlink: true
		});
		await wt.init();

		term = {
			destroy: () => wt.destroy(),
			write: (data) => wt.write(data)
		};

		wt.write(
			`crucible terminal · session ${sessionId}\r\n` +
				`(Phase 0/1: PTY WebSocket bridge not yet wired)\r\n\r\n$ `
		);
	});

	onDestroy(() => {
		term?.destroy();
	});
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	{#if !workspace}
		<EmptyState
			title="No workspace open"
			description="Create or open a workspace to attach a terminal session."
		/>
	{:else if !sessionId}
		<EmptyState
			variant="degraded"
			title="No PTY session attached"
			description="The workspace runtime hasn't reported an active terminal session yet."
		/>
	{:else}
		<div bind:this={host} class="size-full overflow-hidden p-2"></div>
	{/if}
</section>
