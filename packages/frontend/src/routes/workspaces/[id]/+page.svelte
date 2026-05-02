<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import type { WorkspaceState } from '@crucible/types';
	import { workspaceClient } from '$lib/api/workspace';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import { getWalletStore } from '$lib/state/wallet.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';
	import { toast } from 'svelte-sonner';
	import { DevtoolsStream, setDevtoolsStream } from '$lib/state/devtools-stream.svelte';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import StatusBar from '$lib/components/status-bar.svelte';
	import ChatRail from '$lib/components/chat-rail.svelte';
	import EditorPane from '$lib/components/panes/editor-pane.svelte';
	import DevToolsPane from '$lib/components/panes/devtools-pane.svelte';
	import PreviewPane from '$lib/components/panes/preview-pane.svelte';
	import TerminalPane from '$lib/components/panes/terminal-pane.svelte';
	import WalletPane from '$lib/components/panes/wallet-pane.svelte';
	import MemoryPane from '$lib/components/panes/memory-pane.svelte';
	import WorkspaceBootOverlay from '$lib/components/workspace-boot-overlay.svelte';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import BrainIcon from '@lucide/svelte/icons/brain';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import BotIcon from '@lucide/svelte/icons/bot';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import WrenchIcon from '@lucide/svelte/icons/wrench';

	const stream = getAgentStream();
	const wallet = getWalletStore();
	const devtoolsStream = new DevtoolsStream();
	setDevtoolsStream(devtoolsStream);

	let workspace = $state<WorkspaceState | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let activeMainTab = $state<'editor' | 'preview' | 'wallet' | 'memory'>('editor');
	let mainView = $state<'editor' | 'preview' | 'wallet' | 'memory' | 'devtools'>('editor');
	let previousMainTab = $state<'editor' | 'preview' | 'wallet' | 'memory'>('editor');
	let loadedWorkspaceId = $state<string | null>(null);

	// Auto-switch to the wallet tab when a new approval request lands so the
	// user can act on it without hunting for the tab.
	$effect(() => {
		if (wallet.pending.length > 0 && activeMainTab !== 'wallet') {
			activeMainTab = 'wallet';
			if (mainView !== 'devtools') {
				mainView = 'wallet';
			}
		}
	});

	// Fire a sonner toast whenever the pending queue grows so the user
	// notices the approval request even if the wallet tab is already active
	// (auto-switch above is a no-op in that case). Tracks the previous count
	// rather than length alone so resolved requests don't re-toast.
	let lastPendingCount = $state(0);
	$effect(() => {
		const next = wallet.pending.length;
		if (next > lastPendingCount) {
			const newest = wallet.pending[next - 1];
			if (newest) {
				const label =
					newest.method === 'eth_sendTransaction'
						? 'Transaction approval requested'
						: newest.method === 'personal_sign'
							? 'Message signature requested'
							: 'Typed data signature requested';
				toast(label, {
					description: 'Open the wallet pane to review and approve.',
					action: {
						label: 'Review',
						onClick: () => {
							activeMainTab = 'wallet';
							mainView = 'wallet';
						}
					}
				});
			}
		}
		lastPendingCount = next;
	});

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
	// status bar / terminal / preview pick up `chainState` and `previewUrl`
	// once the Docker container reports ready. Cold `bun install` for a fresh
	// workspace's frontend can take well over a minute, so we keep polling
	// while the preview supervisor is still in `installing` / `starting`.
	const POLL_INTERVAL_MS = 2000;
	const POLL_MAX_MS = 600_000;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollStartedAt = 0;
	let pollWorkspaceId: string | null = null;

	function workspaceIsBooted(ws: WorkspaceState | null): boolean {
		if (!ws) return false;
		// Chain must be live (so the bridge has somewhere to forward RPC), the
		// preview supervisor must be in a settled phase, and the auto-deployed
		// Counter template must have either succeeded or failed/been skipped.
		// Without the template gate, the iframe loads while contracts.json is
		// still being written and shows "Connecting…" until the deploy finishes.
		// Terminal session is *not* required — it's only attached when the user
		// opens the terminal pane.
		const chainReady = ws.chainState != null;
		const previewSettled = ws.previewState.phase === 'ready' || ws.previewState.phase === 'failed';
		const templateSettled =
			ws.templateState.phase === 'ready' ||
			ws.templateState.phase === 'failed' ||
			ws.templateState.phase === 'unavailable' ||
			// `idle` after chain boot = backend restart cleared in-memory state;
			// the deploy won't re-run, so don't block the workspace indefinitely.
			ws.templateState.phase === 'idle';
		return chainReady && previewSettled && templateSettled;
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
		// Bind the wallet store to the workspace at page level (not just from
		// inside the wallet pane). bits-ui Tabs unmount inactive content, so
		// without this the store stays unbound until the user clicks the wallet
		// tab — and any sensitive RPC the dApp triggers in the meantime would
		// enqueue against a wallet store that can't refresh accounts.
		wallet.setWorkspace(id);
		try {
			workspace = await workspaceClient.getWorkspace(id);
			// Note: session hydration and stream start are managed by chat-rail.svelte.
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

	// Refresh the dev wallet (account + balance + chainId) once the chain
	// reports a chainState. Lives at page level so the wallet pane shows a
	// connected dev account even before the user clicks the wallet tab.
	// Retries with backoff until `wallet.account` populates or the wallet
	// store records enough consecutive failures to give up — the first call
	// often races chain boot and returns an empty `eth_accounts` or a
	// transient 503 from the rpc proxy.
	const WALLET_MAX_ATTEMPTS = 6;
	let walletRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleWalletRefresh(delayMs: number): void {
		if (walletRefreshTimer) clearTimeout(walletRefreshTimer);
		walletRefreshTimer = setTimeout(async () => {
			walletRefreshTimer = null;
			if (wallet.account) return;
			if (wallet.failedAttempts >= WALLET_MAX_ATTEMPTS) return;
			await wallet.refresh();
			if (!wallet.account && wallet.failedAttempts < WALLET_MAX_ATTEMPTS) {
				// Backoff: 1.5s, 1.5s, 3s, 3s, 6s, 6s …
				scheduleWalletRefresh(Math.min(6000, 1500 * 2 ** Math.floor(wallet.failedAttempts / 2)));
			}
		}, delayMs);
	}
	$effect(() => {
		const id = workspace?.id ?? null;
		const ready = workspace?.chainState != null;
		if (!id || !ready) return;
		if (wallet.account) return;
		if (wallet.refreshing) return;

		// Kick off the first attempt immediately, then let scheduleWalletRefresh
		// handle backoff for subsequent retries until we either get an account
		// or exhaust attempts.
		void wallet.refresh().then(() => {
			if (!wallet.account && wallet.failedAttempts < WALLET_MAX_ATTEMPTS) {
				scheduleWalletRefresh(1500);
			}
		});

		return () => {
			if (walletRefreshTimer) {
				clearTimeout(walletRefreshTimer);
				walletRefreshTimer = null;
			}
		};
	});

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
		wallet.rejectAll();
		devtoolsStream.stop();
	});
</script>

<StatusBar {workspace} />

<main class="relative min-h-0 flex-1">
	{#if !workspaceIsBooted(workspace) || loadError}
		<WorkspaceBootOverlay {workspace} {loading} {loadError} />
	{/if}
	{#if workspace}
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
									activeMainTab = v as 'editor' | 'preview' | 'wallet' | 'memory';
									mainView = v as 'editor' | 'preview' | 'wallet' | 'memory';
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
											<Tabs.Trigger
												value="wallet"
												class="flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground"
											>
												wallet
												{#if wallet.pending.length > 0}
													<Badge
														variant="destructive"
														class="h-4 min-w-4 px-1 font-mono text-[9px] leading-none"
													>
														{wallet.pending.length}
													</Badge>
												{/if}
											</Tabs.Trigger>
											<Tabs.Trigger
												value="memory"
												class="flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground"
											>
												<BrainIcon class="size-3 text-indigo-400" />
												memory
											</Tabs.Trigger>
										</Tabs.List>
									</div>
									<Tabs.Content value="editor" class="m-0 min-h-0 flex-1 overflow-hidden">
										<EditorPane {workspace} />
									</Tabs.Content>
									<Tabs.Content value="preview" class="m-0 min-h-0 flex-1 overflow-hidden">
										<PreviewPane {workspace} />
									</Tabs.Content>
									<Tabs.Content value="wallet" class="m-0 min-h-0 flex-1 overflow-hidden">
										<WalletPane {workspace} />
									</Tabs.Content>
									<Tabs.Content value="memory" class="m-0 min-h-0 flex-1 overflow-hidden">
										<MemoryPane workspaceId={workspace.id} />
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
