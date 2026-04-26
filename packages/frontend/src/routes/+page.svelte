<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import type { WorkspaceState } from '@crucible/types';
	import { workspaceClient } from '$lib/api/workspace';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Tabs from '$lib/components/ui/tabs';
	import StatusBar from '$lib/components/status-bar.svelte';
	import ChatRail from '$lib/components/chat-rail.svelte';
	import EditorPane from '$lib/components/panes/editor-pane.svelte';
	import PreviewPane from '$lib/components/panes/preview-pane.svelte';
	import TerminalPane from '$lib/components/panes/terminal-pane.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Button } from '$lib/components/ui/button';

	const fixtureMode = (env.PUBLIC_USE_FIXTURES ?? 'true') !== 'false';
	const stream = getAgentStream();

	let workspace = $state<WorkspaceState | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let activeMainTab = $state<'editor' | 'preview'>('editor');

	async function openWorkspace(): Promise<void> {
		loading = true;
		loadError = null;
		try {
			const created = await workspaceClient.createWorkspace({ name: 'Vault demo' });
			workspace = await workspaceClient.getWorkspace(created.id);
			stream.start();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void openWorkspace();
	});
</script>

<StatusBar {workspace} {fixtureMode} />

<main class="min-h-0 flex-1">
	{#if loadError}
		<EmptyState variant="degraded" title="Workspace failed to load" description={loadError}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={openWorkspace}>Retry</Button>
			{/snippet}
		</EmptyState>
	{:else if loading && !workspace}
		<EmptyState
			title="Opening workspace…"
			description="Restoring files, starting runtime, attaching terminal."
		/>
	{:else}
		<Resizable.PaneGroup direction="horizontal" class="size-full">
			<Resizable.Pane defaultSize={28} minSize={18} maxSize={45}>
				<ChatRail />
			</Resizable.Pane>
			<Resizable.Handle />
			<Resizable.Pane defaultSize={72} minSize={40}>
				<Resizable.PaneGroup direction="vertical" class="size-full">
					<Resizable.Pane defaultSize={62} minSize={25}>
						<Tabs.Root
							value={activeMainTab}
							onValueChange={(v) => (activeMainTab = v as 'editor' | 'preview')}
							class="flex h-full min-h-0 flex-col"
						>
							<div
								class="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-2 py-1"
							>
								<Tabs.List class="bg-transparent p-0">
									<Tabs.Trigger
										value="editor"
										class="rounded-md px-3 py-1 font-mono text-xs text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground"
									>
										editor
									</Tabs.Trigger>
									<Tabs.Trigger
										value="preview"
										class="rounded-md px-3 py-1 font-mono text-xs text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground"
									>
										preview
									</Tabs.Trigger>
								</Tabs.List>
							</div>
							<Tabs.Content value="editor" class="m-0 min-h-0 flex-1 overflow-hidden">
								<EditorPane {workspace} />
							</Tabs.Content>
							<Tabs.Content value="preview" class="m-0 min-h-0 flex-1 overflow-hidden">
								<PreviewPane {workspace} />
							</Tabs.Content>
						</Tabs.Root>
					</Resizable.Pane>
					<Resizable.Handle />
					<Resizable.Pane defaultSize={38} minSize={15}>
						<TerminalPane {workspace} />
					</Resizable.Pane>
				</Resizable.PaneGroup>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{/if}
</main>
