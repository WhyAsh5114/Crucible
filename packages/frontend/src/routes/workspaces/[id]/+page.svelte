<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import type { WorkspaceState } from '@crucible/types';
	import { workspaceClient } from '$lib/api/workspace';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import { DevtoolsStream, setDevtoolsStream } from '$lib/state/devtools-stream.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import StatusBar from '$lib/components/status-bar.svelte';
	import ChatRail from '$lib/components/chat-rail.svelte';
	import EditorPane from '$lib/components/panes/editor-pane.svelte';
	import DevToolsPane from '$lib/components/panes/devtools-pane.svelte';
	import PreviewPane from '$lib/components/panes/preview-pane.svelte';
	import TerminalPane from '$lib/components/panes/terminal-pane.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import BotIcon from '@lucide/svelte/icons/bot';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import WrenchIcon from '@lucide/svelte/icons/wrench';

	const stream = getAgentStream();
	const devtoolsStream = new DevtoolsStream();
	setDevtoolsStream(devtoolsStream);

	let workspace = $state<WorkspaceState | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let activeMainTab = $state<'editor' | 'preview'>('editor');
	let mainView = $state<'editor' | 'preview' | 'devtools'>('editor');
	let previousMainTab = $state<'editor' | 'preview'>('editor');
	let loadedWorkspaceId = $state<string | null>(null);

	type Tone = 'idle' | 'live' | 'degraded';

	let chainState = $derived<{ label: string; tone: Tone }>(
		workspace?.chainState
			? { label: `chain · block ${workspace.chainState.blockNumber}`, tone: 'live' }
			: { label: 'chain · idle', tone: 'idle' }
	);

	let previewState = $derived<{ label: string; tone: Tone }>(
		workspace?.previewUrl
			? { label: 'preview · ready', tone: 'live' }
			: { label: 'preview · idle', tone: 'degraded' }
	);

	let terminalState = $derived<{ label: string; tone: Tone }>(
		workspace?.terminalSessionId
			? { label: 'terminal · attached', tone: 'live' }
			: { label: 'terminal · idle', tone: 'degraded' }
	);

	let agentState = $derived<{ label: string; tone: Tone }>(
		stream.status === 'streaming'
			? { label: 'agent · streaming', tone: 'live' }
			: stream.status === 'connecting'
				? { label: 'agent · connecting', tone: 'idle' }
				: stream.status === 'closed'
					? { label: 'agent · closed', tone: 'idle' }
					: stream.status === 'error'
						? { label: 'agent · error', tone: 'degraded' }
						: { label: 'agent · idle', tone: 'idle' }
	);

	const toneClass: Record<Tone, string> = {
		idle: 'text-muted-foreground',
		live: 'text-live',
		degraded: 'text-muted-foreground'
	};

	const borderClass: Record<Tone, string> = {
		idle: 'border-border',
		live: 'border-live/40',
		degraded: 'border-border'
	};

	const iconToneClass: Record<Tone, string> = {
		idle: 'text-muted-foreground/60',
		live: 'text-live',
		degraded: 'text-muted-foreground/70'
	};

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
			devtoolsStream.start(workspace.id);
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
		if (loadedWorkspaceId !== id) {
			loadedWorkspaceId = id;
			activeMainTab = 'editor';
			mainView = 'editor';
			previousMainTab = 'editor';
		}
		untrack(() => {
			void loadWorkspace(id);
		});
	});

	function openDevTools(): void {
		if (mainView === 'devtools') return;
		previousMainTab = activeMainTab;
		mainView = 'devtools';
	}

	function closeDevTools(): void {
		mainView = previousMainTab;
		activeMainTab = previousMainTab;
	}

	onMount(() => {
		// no-op; $effect above handles initial load + reactive id changes
	});

	onDestroy(() => {
		clearPoll();
		stream.stop();
		devtoolsStream.stop();
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
				<div class="flex h-full min-h-0 flex-col border-l border-border bg-background">
					<Resizable.PaneGroup direction="vertical" class="min-h-0 flex-1">
						<Resizable.Pane defaultSize={62} minSize={25}>
							{#if mainView === 'devtools'}
								<DevToolsPane workspaceId={workspace.id} onClose={closeDevTools} />
							{:else}
								<Tabs.Root
									value={activeMainTab}
									onValueChange={(v) => {
										activeMainTab = v as 'editor' | 'preview';
										mainView = v as 'editor' | 'preview';
									}}
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
							{/if}
						</Resizable.Pane>
						<Resizable.Handle />
						<Resizable.Pane defaultSize={38} minSize={15}>
							<TerminalPane {workspace} />
						</Resizable.Pane>
					</Resizable.PaneGroup>
					<footer
						class="flex h-8 shrink-0 items-center justify-between border-t border-border bg-muted/15 px-2"
					>
						<div class="flex items-center gap-1.5 overflow-hidden">
							<Badge
								variant="outline"
								class={cn(
									'h-6 font-mono text-[10px]',
									toneClass[chainState.tone],
									borderClass[chainState.tone]
								)}
							>
								<CpuIcon class={cn('mr-1 size-3', iconToneClass[chainState.tone])} />
								{chainState.label}
							</Badge>
							<Badge
								variant="outline"
								class={cn(
									'h-6 font-mono text-[10px]',
									toneClass[previewState.tone],
									borderClass[previewState.tone]
								)}
							>
								<MonitorIcon class={cn('mr-1 size-3', iconToneClass[previewState.tone])} />
								{previewState.label}
							</Badge>
							<Badge
								variant="outline"
								class={cn(
									'h-6 font-mono text-[10px]',
									toneClass[terminalState.tone],
									borderClass[terminalState.tone]
								)}
							>
								<TerminalIcon class={cn('mr-1 size-3', iconToneClass[terminalState.tone])} />
								{terminalState.label}
							</Badge>
							<Badge
								variant="outline"
								class={cn(
									'h-6 font-mono text-[10px]',
									toneClass[agentState.tone],
									borderClass[agentState.tone]
								)}
							>
								<BotIcon class={cn('mr-1 size-3', iconToneClass[agentState.tone])} />
								{agentState.label}
							</Badge>
						</div>
						<Button
							variant={mainView === 'devtools' ? 'secondary' : 'outline'}
							size="sm"
							class="h-6 px-3 font-mono text-[10px] tracking-wide uppercase"
							onclick={openDevTools}
						>
							<WrenchIcon class="mr-1 size-3" />
							DevTools
						</Button>
					</footer>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{/if}
</main>
