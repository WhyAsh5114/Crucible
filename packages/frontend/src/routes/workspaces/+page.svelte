<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { WorkspaceState, WorkspaceSummary, WorkspaceTemplate } from '@crucible/types';
	import { authClient } from '$lib/auth-client';
	import { workspaceClient } from '$lib/api/workspace';
	import { formatRelativeTime } from '$lib/utils/relative-time';
	import WorkspaceSidebar from '$lib/components/workspace-sidebar.svelte';
	import TemplatePickerDialog, {
		TEMPLATE_INFO
	} from '$lib/components/template-picker-dialog.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { toast } from 'svelte-sonner';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
	import LightningIcon from 'phosphor-svelte/lib/LightningIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
	import RocketIcon from 'phosphor-svelte/lib/RocketIcon';
	import { cn } from '$lib/utils';

	const session = authClient.useSession();
	// Layout has gated; assert non-null to avoid sprinkling guards everywhere.
	const user = $derived($session.data!.user);

	let selected = $state<WorkspaceSummary | null>(null);
	let detail = $state<WorkspaceState | null>(null);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);

	// Workspaces list — sourced from the sidebar via callback so we can show
	// stat cards (total / active) on the empty hero without duplicating the
	// HTTP fetch.
	let workspaces = $state<WorkspaceSummary[]>([]);
	const totalCount = $derived(workspaces.length);
	const readyCount = $derived(workspaces.filter((w) => w.runtimeStatus === 'ready').length);
	const recent = $derived([...workspaces].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6));

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

	function templateInfo(id: WorkspaceTemplate) {
		return TEMPLATE_INFO.find((t) => t.id === id) ?? TEMPLATE_INFO[0];
	}

	async function openIde(): Promise<void> {
		if (!selected) return;
		await goto(resolve('/workspaces/[id]', { id: selected.id }));
	}

	// ── Inline template picker ───────────────────────────────────────────────
	// Phase 1: a single shared dialog. Quick-start template tiles open the
	// dialog without preselection — the user can still flip cards inside.
	// A future iteration could deep-link a preselect via a prop on the dialog.
	let templatePickerOpen = $state(false);
	let creating = $state(false);

	function openPicker(_template?: WorkspaceTemplate): void {
		templatePickerOpen = true;
	}

	async function createFromPicker(params: {
		name: string;
		template: WorkspaceTemplate;
	}): Promise<void> {
		creating = true;
		try {
			const created = await workspaceClient.createWorkspace(params);
			templatePickerOpen = false;
			// Navigate straight into the new workspace — that's what the user
			// actually wants 99% of the time after picking a template.
			await goto(resolve('/workspaces/[id]', { id: created.id }));
		} catch (err) {
			toast.error('Failed to create workspace', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			creating = false;
		}
	}
</script>

<Sidebar.Provider class="min-h-0 flex-1">
	<WorkspaceSidebar
		{user}
		selectedId={selected?.id ?? null}
		onSelect={(ws) => (selected = ws)}
		onWorkspacesChange={(list) => (workspaces = list)}
	/>
	<Sidebar.Inset class="bg-background">
		<header
			class="flex h-12 shrink-0 items-center gap-2 border-b border-border pr-12 pl-3 font-mono text-xs text-muted-foreground"
		>
			<Sidebar.Trigger class="-ml-1" />
			<span class="ml-2">workspaces</span>
			<Button size="sm" class="ml-auto" onclick={() => openPicker()}>
				<PlusIcon weight="bold" data-icon="inline-start" />
				New workspace
			</Button>
		</header>

		<main class="min-h-0 flex-1 overflow-y-auto">
			{#if !selected}
				<!-- ── Empty / overview state ─────────────────────────────────── -->
				<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
					<!-- Hero -->
					<div class="flex flex-col gap-2">
						<h1 class="text-2xl font-semibold tracking-tight text-foreground">
							Welcome back, <span class="text-primary">{user.name}</span>
						</h1>
						<p class="max-w-2xl text-sm leading-relaxed text-muted-foreground">
							Crucible is your agentic Web3 sandbox. Pick a template below to scaffold a new
							workspace, or open an existing one from the sidebar — the agent takes it from there.
						</p>
					</div>

					<!-- Stat strip -->
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Card.Root>
							<Card.Content class="flex flex-col gap-1 p-4">
								<div
									class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
								>
									<StackIcon class="size-3" />
									Total
								</div>
								<div class="font-mono text-2xl font-semibold text-foreground tabular-nums">
									{totalCount}
								</div>
							</Card.Content>
						</Card.Root>
						<Card.Root>
							<Card.Content class="flex flex-col gap-1 p-4">
								<div
									class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
								>
									<LightningIcon class="size-3" weight="fill" />
									Ready
								</div>
								<div class="font-mono text-2xl font-semibold text-live tabular-nums">
									{readyCount}
								</div>
							</Card.Content>
						</Card.Root>
						<Card.Root>
							<Card.Content class="flex flex-col gap-1 p-4">
								<div
									class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
								>
									<CodeIcon class="size-3" />
									Templates
								</div>
								<div class="font-mono text-2xl font-semibold text-foreground tabular-nums">
									{TEMPLATE_INFO.length}
								</div>
							</Card.Content>
						</Card.Root>
						<Card.Root>
							<Card.Content class="flex flex-col gap-1 p-4">
								<div
									class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
								>
									<RocketIcon class="size-3" weight="fill" />
									Status
								</div>
								<div
									class={cn(
										'font-mono text-2xl font-semibold tabular-nums',
										readyCount > 0 ? 'text-live' : 'text-muted-foreground'
									)}
								>
									{readyCount > 0 ? 'live' : 'idle'}
								</div>
							</Card.Content>
						</Card.Root>
					</div>

					<!-- Quick-start templates -->
					<div class="flex flex-col gap-3">
						<div class="flex items-center justify-between gap-2">
							<h2 class="font-mono text-xs tracking-wider text-muted-foreground uppercase">
								Quick start
							</h2>
						</div>
						<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
							{#each TEMPLATE_INFO as info (info.id)}
								{@const Icon = info.icon}
								<button
									type="button"
									onclick={() => openPicker(info.id)}
									class="group flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								>
									<div class="flex items-start justify-between gap-2">
										<div
											class="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
										>
											<Icon class="size-5" weight="fill" />
										</div>
										<PlusIcon
											class="size-4 text-muted-foreground/40 transition-colors group-hover:text-primary"
											weight="bold"
										/>
									</div>
									<div class="flex flex-col gap-1">
										<h3 class="font-mono text-sm font-medium text-foreground">{info.name}</h3>
										<p class="text-xs leading-relaxed text-muted-foreground">{info.tagline}</p>
									</div>
									<div class="mt-auto flex flex-wrap gap-1 pt-1">
										{#each info.tags as tag (tag)}
											<Badge variant="outline" class="font-mono text-[9px]">{tag}</Badge>
										{/each}
									</div>
								</button>
							{/each}
						</div>
					</div>

					<!-- Recent workspaces -->
					{#if recent.length > 0}
						<div class="flex flex-col gap-3">
							<h2 class="font-mono text-xs tracking-wider text-muted-foreground uppercase">
								Recent workspaces
							</h2>
							<div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
								{#each recent as ws (ws.id)}
									{@const tinfo = templateInfo(ws.template)}
									{@const TIcon = tinfo.icon}
									<button
										type="button"
										onclick={() => (selected = ws)}
										class="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									>
										<div class="flex items-start justify-between gap-2">
											<div class="flex min-w-0 items-center gap-2">
												<div
													class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
												>
													<TIcon class="size-4" weight="fill" />
												</div>
												<div class="flex min-w-0 flex-col">
													<span class="truncate font-mono text-sm text-foreground">{ws.name}</span>
													<span class="font-mono text-[10px] text-muted-foreground/60">
														{tinfo.name}
													</span>
												</div>
											</div>
											{#if ws.runtimeStatus}
												<Badge
													variant={statusVariant(ws.runtimeStatus)}
													class="font-mono text-[9px]"
												>
													{ws.runtimeStatus}
												</Badge>
											{:else}
												<Badge variant="outline" class="font-mono text-[9px]">never</Badge>
											{/if}
										</div>
										<div
											class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
										>
											<span class="font-mono">{formatRelativeTime(ws.createdAt)}</span>
											<span class="font-mono opacity-60">{ws.id.slice(-8)}</span>
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<!-- ── Selected workspace detail ──────────────────────────────── -->
				{@const tinfo = templateInfo(selected.template)}
				{@const TIcon = tinfo.icon}
				<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
					<!-- Hero card -->
					<Card.Root class="overflow-hidden">
						<div
							class="h-1 w-full bg-gradient-to-r from-primary/40 via-primary/10 to-live/30"
						></div>
						<Card.Header>
							<div class="flex items-start justify-between gap-3">
								<div class="flex min-w-0 items-center gap-3">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
									>
										<TIcon class="size-6" weight="fill" />
									</div>
									<div class="flex min-w-0 flex-col gap-0.5">
										<Card.Title class="truncate font-mono">{selected.name}</Card.Title>
										<Card.Description class="font-mono text-[10px]">
											{tinfo.name} · {selected.id}
										</Card.Description>
									</div>
								</div>
								{#if selected.runtimeStatus}
									<Badge
										variant={statusVariant(selected.runtimeStatus)}
										class="font-mono text-[10px]"
									>
										{selected.runtimeStatus}
									</Badge>
								{:else}
									<Badge variant="outline" class="font-mono text-[10px]">never started</Badge>
								{/if}
							</div>
							<p class="pt-2 text-xs leading-relaxed text-muted-foreground">
								{tinfo.description}
							</p>
						</Card.Header>
					</Card.Root>

					<!-- Stat tiles -->
					{#if detailLoading && !detail}
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
							{#each [0, 1, 2, 3] as i (i)}
								<Skeleton class="h-20 w-full rounded-lg" />
							{/each}
						</div>
					{:else if detailError}
						<Card.Root class="border-destructive/40 bg-destructive/5">
							<Card.Content class="p-4 text-xs text-destructive">{detailError}</Card.Content>
						</Card.Root>
					{:else if detail}
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<Card.Root>
								<Card.Content class="flex flex-col gap-1 p-4">
									<div
										class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
									>
										<LightningIcon class="size-3" weight="fill" />
										Chain
									</div>
									<div class="font-mono text-lg font-semibold text-foreground tabular-nums">
										{#if detail.chainState}
											#{detail.chainState.blockNumber}
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</div>
								</Card.Content>
							</Card.Root>
							<Card.Root>
								<Card.Content class="flex flex-col gap-1 p-4">
									<div
										class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
									>
										<GlobeIcon class="size-3" weight="fill" />
										Preview
									</div>
									<div class="font-mono text-lg font-semibold text-foreground">
										{#if detail.previewUrl}
											<span class="text-live">live</span>
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</div>
								</Card.Content>
							</Card.Root>
							<Card.Root>
								<Card.Content class="flex flex-col gap-1 p-4">
									<div
										class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
									>
										<CodeIcon class="size-3" />
										Files
									</div>
									<div class="font-mono text-lg font-semibold text-foreground tabular-nums">
										{detail.files.length}
									</div>
								</Card.Content>
							</Card.Root>
							<Card.Root>
								<Card.Content class="flex flex-col gap-1 p-4">
									<div
										class="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
									>
										<RocketIcon class="size-3" weight="fill" />
										Deploys
									</div>
									<div class="font-mono text-lg font-semibold text-foreground tabular-nums">
										{detail.deployments.length}
									</div>
								</Card.Content>
							</Card.Root>
						</div>

						<!-- Detail rows -->
						<Card.Root>
							<Card.Content class="flex flex-col gap-3 p-4 font-mono text-xs">
								<div class="flex items-center justify-between gap-3">
									<span class="flex items-center gap-1.5 text-muted-foreground">
										<GlobeIcon class="size-3" />
										Preview URL
									</span>
									{#if detail.previewUrl}
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={detail.previewUrl}
											target="_blank"
											rel="noreferrer"
											class="truncate text-primary hover:underline"
										>
											{detail.previewUrl}
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{:else}
										<span class="text-muted-foreground">not yet</span>
									{/if}
								</div>
								<div class="flex items-center justify-between gap-3">
									<span class="flex items-center gap-1.5 text-muted-foreground">
										<TerminalWindowIcon class="size-3" />
										Terminal
									</span>
									<span class="truncate text-foreground/80">
										{#if detail.terminalSessionId}
											{detail.terminalSessionId}
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</span>
								</div>
								<div class="flex items-center justify-between gap-3">
									<span class="text-muted-foreground">Created</span>
									<span class="text-foreground/80">
										{new Date(selected.createdAt).toLocaleString()}
										<span class="ml-2 text-muted-foreground/70">
											({formatRelativeTime(selected.createdAt)})
										</span>
									</span>
								</div>
							</Card.Content>
						</Card.Root>
					{/if}

					<!-- CTA -->
					<div class="flex justify-end">
						<Button size="lg" onclick={openIde} disabled={detailLoading}>
							<FolderOpenIcon weight="bold" data-icon="inline-start" />
							Open IDE
						</Button>
					</div>
				</div>
			{/if}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<TemplatePickerDialog bind:open={templatePickerOpen} {creating} onCreate={createFromPicker} />
