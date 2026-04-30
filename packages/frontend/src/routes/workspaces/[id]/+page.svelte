<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
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

	const stream = getAgentStream();

	let workspace = $state<WorkspaceState | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let activeMainTab = $state<'editor' | 'preview'>('editor');

	const workspaceId = $derived(page.params.id);

	// Poll the workspace endpoint while the runtime is still booting so the
	// status bar / terminal / preview pick up `terminalSessionId`, `chainState`,
	// and `previewUrl` once the Docker container reports ready. The single
	// initial fetch alone leaves the UI permanently stuck if the container
	// hasn't finished booting by the time the page mounts (default 60s).
	const POLL_INTERVAL_MS = 2000;
	const POLL_MAX_MS = 120_000;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollStartedAt = 0;
	let pollWorkspaceId: string | null = null;

	function workspaceIsBooted(ws: WorkspaceState | null): boolean {
		// `previewUrl` is intentionally excluded: the preview supervisor is wired
		// (startPreview is called from api/workspace.ts and api/runtime.ts), but
		// `terminalSessionId` is not yet wired — so the poll never terminates on
		// that criterion alone. `previewUrl` is therefore picked up passively
		// during the 120s polling window rather than being a hard boot gate.
		return Boolean(ws && ws.chainState && ws.terminalSessionId);
	}

	function clearPoll(): void {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		pollWorkspaceId = null;
	}

	function schedulePoll(id: string): void {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = setTimeout(() => {
			void pollWorkspace(id);
		}, POLL_INTERVAL_MS);
	}

	async function pollWorkspace(id: string): Promise<void> {
		// Guard against stale timers firing after navigation/unmount.
		if (pollWorkspaceId !== id) return;
		try {
			const next = await workspaceClient.getWorkspace(id);
			if (pollWorkspaceId !== id) return;
			workspace = next;
			if (workspaceIsBooted(next)) {
				clearPoll();
				return;
			}
		} catch {
			// Swallow transient polling errors; the next tick will retry. The
			// initial load already surfaced any hard failure via `loadError`.
		}
		if (Date.now() - pollStartedAt >= POLL_MAX_MS) {
			clearPoll();
			return;
		}
		schedulePoll(id);
	}

	async function loadWorkspace(id: string): Promise<void> {
		clearPoll();
		loading = true;
		loadError = null;
		workspace = null;
		try {
			workspace = await workspaceClient.getWorkspace(id);
			await stream.hydrate(workspace.id);
			stream.start(workspace.id);
			if (!workspaceIsBooted(workspace)) {
				pollWorkspaceId = id;
				pollStartedAt = Date.now();
				schedulePoll(id);
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const id = workspaceId;
		if (!id) return;
		untrack(() => {
			void loadWorkspace(id);
		});
	});

	onMount(() => {
		// no-op; $effect above handles initial load + reactive id changes
	});

	onDestroy(() => {
		clearPoll();
		stream.stop();
	});
</script>

<StatusBar {workspace} />

<main class="min-h-0 flex-1">
	{#if loadError}
		<EmptyState variant="degraded" title="Workspace failed to load" description={loadError} />
	{:else if loading && !workspace}
		<EmptyState
			title="Opening workspace…"
			description="Restoring files, starting runtime, attaching terminal."
		/>
	{:else if workspace}
		<Resizable.PaneGroup direction="horizontal" class="size-full">
			<Resizable.Pane defaultSize={28} minSize={18} maxSize={45}>
				<ChatRail workspaceId={workspace.id} />
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
