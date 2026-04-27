<script lang="ts">
	import type { WorkspaceSummary } from '@crucible/types';
	import { authClient } from '$lib/auth-client';
	import { workspaceClient } from '$lib/api/workspace';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';

	type Props = {
		user: { id: string; name: string; email?: string | null; image?: string | null };
		selectedId: string | null;
		onSelect: (workspace: WorkspaceSummary) => void;
		onWorkspacesChange?: (workspaces: WorkspaceSummary[]) => void;
	};
	let { user, selectedId, onSelect, onWorkspacesChange }: Props = $props();

	let workspaces = $state<WorkspaceSummary[]>([]);
	let loading = $state(true);
	let creating = $state(false);

	const avatarSeed = $derived(user.email ?? user.id);
	const avatarUrl = $derived(`https://avatar.vercel.sh/${encodeURIComponent(avatarSeed)}`);
	const initials = $derived(
		(user.name || user.email || 'U')
			.trim()
			.split(/\s+/)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('')
			.slice(0, 2) || 'U'
	);

	$effect(() => {
		void refresh();
	});

	async function refresh(): Promise<void> {
		loading = true;
		try {
			const res = await workspaceClient.listWorkspaces();
			workspaces = res.workspaces;
			onWorkspacesChange?.(workspaces);
		} catch (err) {
			toast.error('Failed to load workspaces', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			loading = false;
		}
	}

	async function createWorkspace(): Promise<void> {
		creating = true;
		try {
			const created = await workspaceClient.createWorkspace({ name: 'Untitled workspace' });
			await refresh();
			const next = workspaces.find((ws) => ws.id === created.id);
			if (next) onSelect(next);
		} catch (err) {
			toast.error('Failed to create workspace', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			creating = false;
		}
	}

	async function signOut(): Promise<void> {
		await authClient.signOut();
		window.location.assign('/');
	}

	const statusDotClass: Record<NonNullable<WorkspaceSummary['runtimeStatus']>, string> = {
		ready: 'bg-live shadow-[0_0_6px_var(--live)]',
		starting: 'bg-muted-foreground',
		degraded: 'bg-muted-foreground/60',
		crashed: 'bg-destructive',
		stopped: 'bg-muted-foreground/40'
	};
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg" class="cursor-default">
					<div
						class="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
					>
						<CubeIcon weight="bold" />
					</div>
					<div class="flex flex-col gap-0.5 leading-none">
						<span class="font-semibold">Crucible</span>
						<span class="text-xs text-muted-foreground">Web3 dev sandbox</span>
					</div>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Workspaces</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#if loading}
						{#each [0, 1, 2] as i (i)}
							<Sidebar.MenuItem>
								<Skeleton class="h-8 w-full rounded-md" />
							</Sidebar.MenuItem>
						{/each}
					{:else if workspaces.length === 0}
						<Sidebar.MenuItem>
							<p class="px-2 py-1.5 text-xs text-muted-foreground">No workspaces yet.</p>
						</Sidebar.MenuItem>
					{:else}
						{#each workspaces as ws (ws.id)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton isActive={ws.id === selectedId} onclick={() => onSelect(ws)}>
									<FolderIcon />
									<span class="truncate">{ws.name}</span>
									{#if ws.runtimeStatus}
										<span
											aria-label={ws.runtimeStatus}
											class={cn('ml-auto size-1.5 rounded-full', statusDotClass[ws.runtimeStatus])}
										></span>
									{/if}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					{/if}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							aria-disabled={creating}
							onclick={() => {
								if (!creating) void createWorkspace();
							}}
						>
							<PlusIcon weight="bold" />
							<span>{creating ? 'Creating…' : 'New workspace'}</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton size="lg" {...props}>
								<Avatar.Root class="size-8">
									<Avatar.Image src={avatarUrl} alt={user.name} />
									<Avatar.Fallback>{initials}</Avatar.Fallback>
								</Avatar.Root>
								<div class="flex min-w-0 flex-col gap-0.5 text-left leading-tight">
									<span class="truncate text-sm font-medium">{user.name}</span>
									{#if user.email}
										<span class="truncate text-xs text-muted-foreground">{user.email}</span>
									{/if}
								</div>
								<CaretUpDownIcon class="ml-auto" />
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="end" class="w-56">
						<DropdownMenu.Group>
							<DropdownMenu.Label class="flex items-center gap-2">
								<Avatar.Root class="size-8">
									<Avatar.Image src={avatarUrl} alt={user.name} />
									<Avatar.Fallback>{initials}</Avatar.Fallback>
								</Avatar.Root>
								<div class="flex min-w-0 flex-col gap-0.5 text-left leading-tight">
									<span class="truncate text-sm font-medium">{user.name}</span>
									{#if user.email}
										<span class="truncate text-xs text-muted-foreground">{user.email}</span>
									{/if}
								</div>
							</DropdownMenu.Label>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={signOut}>
							<SignOutIcon />
							Sign out
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
