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
	import InspectorPane from '$lib/components/inspector/inspector-pane.svelte';
	import WorkspaceBootOverlay from '$lib/components/workspace-boot-overlay.svelte';
	import WalletApprovalDialog from '$lib/components/wallet-approval-dialog.svelte';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import BotIcon from '@lucide/svelte/icons/bot';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import PenLineIcon from '@lucide/svelte/icons/pen-line';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import BugIcon from '@lucide/svelte/icons/bug';

	const stream = getAgentStream();
	const wallet = getWalletStore();
	const devtoolsStream = new DevtoolsStream();
	setDevtoolsStream(devtoolsStream);

	let workspace = $state<WorkspaceState | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let activeMainTab = $state<'editor' | 'preview' | 'wallet' | 'inspector'>('editor');
	let mainView = $state<'editor' | 'preview' | 'wallet' | 'inspector' | 'devtools'>('editor');
	let previousMainTab = $state<'editor' | 'preview' | 'wallet' | 'inspector'>('editor');
	let loadedWorkspaceId = $state<string | null>(null);
	// Latch: once a workspace has finished its initial boot we never show the
	// full-screen boot overlay again for that session, even if a sub-component
	// (preview Vite, chain, etc.) restarts and briefly flips back through
	// `installing` / `starting` phases. Subsequent restarts surface inside the
	// affected pane only.
	let hasBootedOnce = $state(false);

	// Wallet approval requests no longer hijack the active tab: they surface
	// as a centered Dialog (`WalletApprovalDialog` mounted below) so the user
	// can stay on the preview/editor tab they were on, approve in place, and
	// drop straight back into context. The previous auto-switch + toast
	// pattern was disorienting once the dApp was driving multiple txs.

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

	// Poll the workspace endpoint to keep the UI in sync with backend state.
	// Two cadences:
	//   - FAST (2s): during boot + after any user-initiated refresh, so we
	//     pick up newly-assigned previewUrl, chainState etc. quickly.
	//   - SLOW (10s): steady-state, after the workspace has reported booted
	//     at least once. We can't STOP polling because the preview Vite can
	//     crash or be restarted later (e.g. user clicks refresh), and the
	//     frontend needs to learn about the new previewUrl. 10s is the
	//     longest a user should wait to see a crash reflected in the pane.
	// `pollDeadline` caps how long fast-mode runs so a failed boot doesn't
	// hammer the backend forever — once exceeded we drop to slow regardless.
	const POLL_FAST_MS = 2000;
	const POLL_SLOW_MS = 10_000;
	const POLL_FAST_MAX_MS = 600_000;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollStartedAt = 0;
	let pollWorkspaceId: string | null = null;
	let pollMode: 'fast' | 'slow' = 'fast';

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
		const interval = pollMode === 'fast' ? POLL_FAST_MS : POLL_SLOW_MS;
		pollTimer = setTimeout(() => {
			void pollWorkspace(id);
		}, interval);
	}

	async function pollWorkspace(id: string): Promise<void> {
		// Guard against stale timers firing after navigation/unmount.
		if (pollWorkspaceId !== id) return;
		try {
			const next = await workspaceClient.getWorkspace(id);
			if (pollWorkspaceId !== id) return;
			workspace = next;
			// Once the workspace has reached a settled state (chain up, preview
			// settled, template settled), drop to slow cadence — but keep
			// polling so we'll catch a later Vite crash / backend-side restart.
			if (pollMode === 'fast' && workspaceIsBooted(next)) {
				pollMode = 'slow';
			}
			// Latch the "booted once" flag the first time we observe a settled
			// state. From here on, sub-component restarts (preview Vite,
			// chain, …) keep their progress UI inside their own pane rather
			// than reopening the full-screen boot overlay.
			if (!hasBootedOnce && workspaceIsBooted(next)) {
				hasBootedOnce = true;
			}
			// If we're in slow mode and the preview state has degraded
			// (no URL but phase claims ready, or phase is installing /
			// starting / failed), bump back to fast so the user sees the
			// resolution quickly.
			if (pollMode === 'slow') {
				const phase = next.previewState.phase;
				const previewUnhealthy = !next.previewUrl || phase === 'installing' || phase === 'starting';
				if (previewUnhealthy) {
					pollMode = 'fast';
					pollStartedAt = Date.now();
				}
			}
		} catch {
			// Swallow transient polling errors; the next tick will retry. The
			// initial load already surfaced any hard failure via `loadError`.
		}
		// Cap continuous fast polling so a permanently-failing workspace
		// doesn't hammer the backend. Once exceeded we drop to slow until
		// the next user-initiated bump.
		if (pollMode === 'fast' && Date.now() - pollStartedAt >= POLL_FAST_MAX_MS) {
			pollMode = 'slow';
		}
		schedulePoll(id);
	}

	/**
	 * Force polling back to fast cadence. Called by the preview pane after
	 * a user-initiated restart so the UI sees the new previewUrl as soon as
	 * the backend assigns one.
	 */
	function bumpPollingFast(): void {
		pollMode = 'fast';
		pollStartedAt = Date.now();
		if (pollWorkspaceId && pollTimer) {
			// Reschedule immediately at fast cadence rather than waiting for
			// the current slow-mode timer to elapse.
			schedulePoll(pollWorkspaceId);
		}
	}

	async function restartPreview(): Promise<void> {
		if (!workspace) return;
		try {
			await workspaceClient.restartPreview(workspace.id);
		} catch (err) {
			toast.error('Failed to restart preview', {
				description: err instanceof Error ? err.message : String(err)
			});
			return;
		}
		bumpPollingFast();
	}

	async function loadWorkspace(id: string): Promise<void> {
		clearPoll();
		loading = true;
		loadError = null;
		workspace = null;
		// New workspace → reset the boot-once latch so the overlay covers the
		// initial boot of this workspace.
		hasBootedOnce = false;
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
			// Always start polling. If already booted we drop to slow cadence
			// immediately on the first tick; if not, we stay at fast cadence
			// until boot completes. Either way we never stop — Vite can crash
			// or restart later and the UI must learn about it.
			pollWorkspaceId = id;
			pollStartedAt = Date.now();
			const initiallyBooted = workspaceIsBooted(workspace);
			pollMode = initiallyBooted ? 'slow' : 'fast';
			// If the workspace was already booted on initial load (e.g. user
			// navigated away and back), latch the flag immediately so the
			// boot overlay never appears.
			if (initiallyBooted) hasBootedOnce = true;
			schedulePoll(id);
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

<!--
	Mounted at the IDE root so the approval dialog can overlay any pane
	(editor / preview / wallet / terminal) when the dApp triggers a wallet
	action via the bridge. Self-contained — pulls pending state from the
	wallet store via `getWalletStore()`.
-->
<WalletApprovalDialog />

<main class="relative min-h-0 flex-1">
	{#if (!hasBootedOnce && !workspaceIsBooted(workspace)) || loadError}
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
										activeMainTab = v as 'editor' | 'preview' | 'wallet' | 'inspector';
										mainView = v as 'editor' | 'preview' | 'wallet' | 'inspector';
									}}
									class="flex h-full min-h-0 flex-col"
								>
									<div
										class="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-2 py-1"
									>
										<Tabs.List class="bg-transparent p-0">
											<Tabs.Trigger
												value="editor"
												class="flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs text-muted-foreground transition-colors data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
											>
												<PenLineIcon class="size-3.5" />
												editor
											</Tabs.Trigger>
											<Tabs.Trigger
												value="preview"
												class="flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs text-muted-foreground transition-colors data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
											>
												<MonitorIcon class="size-3.5" />
												preview
											</Tabs.Trigger>
											<Tabs.Trigger
												value="inspector"
												class="flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs text-muted-foreground transition-colors data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
											>
												<BugIcon class="size-3.5" />
												inspector
											</Tabs.Trigger>
											<Tabs.Trigger
												value="wallet"
												class="flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs text-muted-foreground transition-colors data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
											>
												<WalletIcon class="size-3.5" />
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
										</Tabs.List>
									</div>
									<Tabs.Content value="editor" class="m-0 min-h-0 flex-1 overflow-hidden">
										<EditorPane {workspace} />
									</Tabs.Content>
									<Tabs.Content value="preview" class="m-0 min-h-0 flex-1 overflow-hidden">
										<PreviewPane {workspace} onRestart={restartPreview} />
									</Tabs.Content>
									<Tabs.Content value="inspector" class="m-0 min-h-0 flex-1 overflow-hidden">
										<InspectorPane />
									</Tabs.Content>
									<Tabs.Content value="wallet" class="m-0 min-h-0 flex-1 overflow-hidden">
										<WalletPane {workspace} />
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
