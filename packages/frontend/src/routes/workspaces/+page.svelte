<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { WorkspaceState, WorkspaceSummary } from '@crucible/types';
	import { authClient } from '$lib/auth-client';
	import { workspaceClient } from '$lib/api/workspace';
	import { formatRelativeTime } from '$lib/utils/relative-time';
	import WorkspaceSidebar from '$lib/components/workspace-sidebar.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Card from '$lib/components/ui/card';
	import * as Empty from '$lib/components/ui/empty';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';

	const session = authClient.useSession();
	// Layout has gated; assert non-null to avoid sprinkling guards everywhere.
	const user = $derived($session.data!.user);

	let selected = $state<WorkspaceSummary | null>(null);
	let detail = $state<WorkspaceState | null>(null);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);

	// Refetch the full workspace state every time the selection changes. Also
	// clear stale data so the previous workspace's details can't flash for
	// the new one.
	$effect(() => {
		const id = selected?.id ?? null;
		detail = null;
		detailError = null;
		if (id === null) return;
		void loadDetail(id);
	});

	async function loadDetail(id: string): Promise<void> {
		detailLoading = true;
		try {
			detail = await workspaceClient.getWorkspace(id);
		} catch (err) {
			detailError = err instanceof Error ? err.message : String(err);
		} finally {
			detailLoading = false;
		}
	}

	function statusVariant(
		status: WorkspaceSummary['runtimeStatus']
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'ready') return 'default';
		if (status === 'crashed') return 'destructive';
		if (status === 'starting') return 'secondary';
		return 'outline';
	}

	async function openIde(): Promise<void> {
		if (!selected) return;
		await goto(resolve('/workspaces/[id]', { id: selected.id }));
	}
</script>

<Sidebar.Provider class="min-h-0 flex-1">
	<WorkspaceSidebar {user} selectedId={selected?.id ?? null} onSelect={(ws) => (selected = ws)} />
	<Sidebar.Inset class="bg-background">
		<header
			class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 font-mono text-xs text-muted-foreground"
		>
			<Sidebar.Trigger class="-ml-1" />
			<span class="ml-2">workspaces</span>
		</header>

		<main class="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6">
			{#if !selected}
				<div class="flex h-full items-center justify-center">
					<Empty.Root>
						<Empty.Header>
							<Empty.Title>Welcome back, {user.name}</Empty.Title>
							<Empty.Description>
								Pick a workspace from the sidebar to see its details, or create a new one.
							</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				</div>
			{:else}
				<Card.Root class="w-full max-w-2xl">
					<Card.Header>
						<div class="flex items-start justify-between gap-3">
							<div class="flex min-w-0 flex-col gap-1">
								<Card.Title>{selected.name}</Card.Title>
								<Card.Description class="font-mono text-[10px]">
									{selected.id}
								</Card.Description>
							</div>
							{#if selected.runtimeStatus}
								<Badge variant={statusVariant(selected.runtimeStatus)} class="text-[10px]">
									{selected.runtimeStatus}
								</Badge>
							{:else}
								<Badge variant="outline" class="text-[10px]">never started</Badge>
							{/if}
						</div>
					</Card.Header>

					<Card.Content class="flex flex-col gap-4">
						<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
							<dt class="text-muted-foreground">Created</dt>
							<dd class="font-mono">
								{new Date(selected.createdAt).toLocaleString()}
								<span class="ml-2 text-muted-foreground">
									({formatRelativeTime(selected.createdAt)})
								</span>
							</dd>
						</dl>

						<Separator />

						{#if detailLoading && !detail}
							<div class="flex flex-col gap-2">
								<Skeleton class="h-4 w-1/3" />
								<Skeleton class="h-4 w-2/3" />
								<Skeleton class="h-4 w-1/2" />
								<Skeleton class="h-4 w-1/4" />
							</div>
						{:else if detailError}
							<p class="text-xs text-destructive">{detailError}</p>
						{:else if detail}
							<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
								<dt class="text-muted-foreground">Preview</dt>
								<dd class="truncate font-mono">
									{#if detail.previewUrl}
										<!-- External preview-origin URL; no SvelteKit resolve() applies. -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={detail.previewUrl}
											target="_blank"
											rel="noreferrer"
											class="text-foreground hover:underline"
										>
											{detail.previewUrl}
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{:else}
										<span class="text-muted-foreground">not yet</span>
									{/if}
								</dd>

								<dt class="text-muted-foreground">Terminal</dt>
								<dd class="truncate font-mono">
									{#if detail.terminalSessionId}
										{detail.terminalSessionId}
									{:else}
										<span class="text-muted-foreground">—</span>
									{/if}
								</dd>

								<dt class="text-muted-foreground">Chain</dt>
								<dd class="truncate font-mono">
									{#if detail.chainState}
										block {detail.chainState.blockNumber}
									{:else}
										<span class="text-muted-foreground">no chain</span>
									{/if}
								</dd>

								<dt class="text-muted-foreground">Deployments</dt>
								<dd class="font-mono">{detail.deployments.length}</dd>

								<dt class="text-muted-foreground">Files</dt>
								<dd class="font-mono">{detail.files.length}</dd>
							</dl>
						{/if}
					</Card.Content>

					<Card.Footer>
						<Button onclick={openIde} disabled={detailLoading}>
							<FolderOpenIcon data-icon="inline-start" weight="bold" />
							Open IDE
						</Button>
					</Card.Footer>
				</Card.Root>
			{/if}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
