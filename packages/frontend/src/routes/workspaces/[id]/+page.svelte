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
	import StatusBar from '$lib/components/status-bar.svelte';
	import ChatRail from '$lib/components/chat-rail.svelte';
	import EditorPane from '$lib/components/panes/editor-pane.svelte';
	import PreviewPane from '$lib/components/panes/preview-pane.svelte';
	import TerminalPane from '$lib/components/panes/terminal-pane.svelte';
	import WalletPane from '$lib/components/panes/wallet-pane.svelte';
	import WorkspaceBootOverlay from '$lib/components/workspace-boot-overlay.svelte';

	const stream = getAgentStream();
	const wallet = getWalletStore();

	let workspace = $state<WorkspaceState | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let activeMainTab = $state<'editor' | 'preview' | 'wallet'>('editor');

	// Auto-switch to the wallet tab when a new approval request lands so the
	// user can act on it without hunting for the tab.
	$effect(() => {
		if (wallet.pending.length > 0 && activeMainTab !== 'wallet') {
			activeMainTab = 'wallet';
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
						}
					}
				});
			}
		}
		lastPendingCount = next;
	});

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
			ws.templateState.phase === 'unavailable';
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
		wallet.rejectAll();
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
				<Resizable.PaneGroup direction="vertical" class="size-full">
					<Resizable.Pane defaultSize={62} minSize={25}>
						<Tabs.Root
							value={activeMainTab}
							onValueChange={(v) => (activeMainTab = v as 'editor' | 'preview' | 'wallet')}
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
