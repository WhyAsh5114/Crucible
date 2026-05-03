<script lang="ts">
	import type { WorkspaceSummary, WorkspaceTemplate } from '@crucible/types';
	import { authClient } from '$lib/auth-client';
	import { workspaceClient } from '$lib/api/workspace';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import TemplatePickerDialog, {
		TEMPLATE_INFO
	} from '$lib/components/template-picker-dialog.svelte';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';

	// Per-template icon shorthand. The picker dialog already declares the
	// mapping; we just look it up by id rather than duplicating the table.
	function templateIconFor(id: WorkspaceSummary['template']) {
		return TEMPLATE_INFO.find((t) => t.id === id)?.icon ?? TEMPLATE_INFO[0]!.icon;
	}

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

	let templatePickerOpen = $state(false);

	function openTemplatePicker(): void {
		templatePickerOpen = true;
	}

	async function createWorkspaceWithTemplate(params: {
		name: string;
		template: WorkspaceTemplate;
	}): Promise<void> {
		creating = true;
		try {
			const created = await workspaceClient.createWorkspace(params);
			await refresh();
			templatePickerOpen = false;
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

	// Status dots only render for *non-steady* states. Marking every ready
	// workspace with a glowing green dot turns the sidebar into a wall of
	// indicators and trains the eye to ignore them — exactly the opposite
	// of what an indicator should do. Showing the dot only for things that
	// need attention (booting / degraded / crashed / stopped) keeps the
	// sidebar calm in the common case.
	const statusDotClass: Record<NonNullable<WorkspaceSummary['runtimeStatus']>, string> = {
		ready: '',
		starting: 'bg-primary animate-pulse',
		degraded: 'bg-warning',
		crashed: 'bg-destructive',
		stopped: 'bg-muted-foreground/40'
	};

	// Rename + delete state. We track which workspace each dialog targets so the
	// dropdown can close cleanly before the dialog mounts (avoids focus-trap fights).
	let renameTarget = $state<WorkspaceSummary | null>(null);
	let renameOpen = $state(false);
	let renameValue = $state('');
	let renameSaving = $state(false);

	let deleteTarget = $state<WorkspaceSummary | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state(false);

	function openRename(ws: WorkspaceSummary): void {
		renameTarget = ws;
		renameValue = ws.name;
		renameOpen = true;
	}

	function openDelete(ws: WorkspaceSummary): void {
		deleteTarget = ws;
		deleteOpen = true;
	}

	async function submitRename(): Promise<void> {
		if (!renameTarget) return;
		const trimmed = renameValue.trim();
		if (!trimmed) {
			toast.error('Workspace name cannot be empty');
			return;
		}
		if (trimmed === renameTarget.name) {
			renameOpen = false;
			return;
		}
		renameSaving = true;
		try {
			await workspaceClient.renameWorkspace(renameTarget.id, { name: trimmed });
			await refresh();
			toast.success('Workspace renamed');
			renameOpen = false;
		} catch (err) {
			toast.error('Failed to rename workspace', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			renameSaving = false;
		}
	}

	async function confirmDelete(): Promise<void> {
		if (!deleteTarget) return;
		const target = deleteTarget;
		deleting = true;
		try {
			await workspaceClient.deleteWorkspace(target.id);
			const wasSelected = selectedId === target.id;
			await refresh();
			toast.success(`Deleted "${target.name}"`);
			deleteOpen = false;
			if (wasSelected && workspaces.length > 0) {
				const next = workspaces[0];
				if (next) onSelect(next);
			}
		} catch (err) {
			toast.error('Failed to delete workspace', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			deleting = false;
		}
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg" class="cursor-default">
					<div
						class="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
					>
						<img src="/icon.svg" alt="Crucible" class="size-5" />
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
							{@const TIcon = templateIconFor(ws.template)}
							{@const dotClass = ws.runtimeStatus ? statusDotClass[ws.runtimeStatus] : ''}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton isActive={ws.id === selectedId} onclick={() => onSelect(ws)}>
									<TIcon weight="fill" />
									<span class="truncate">{ws.name}</span>
									{#if dotClass}
										<span
											aria-label={ws.runtimeStatus ?? undefined}
											class={cn('mr-5 ml-auto size-1.5 rounded-full', dotClass)}
										></span>
									{/if}
								</Sidebar.MenuButton>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Sidebar.MenuAction
												showOnHover
												aria-label="Workspace actions"
												onclick={(event: MouseEvent) => {
													event.stopPropagation();
												}}
												{...props}
											>
												<DotsThreeIcon weight="bold" />
											</Sidebar.MenuAction>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content side="right" align="start" class="w-40">
										<DropdownMenu.Item onSelect={() => openRename(ws)}>
											<PencilSimpleIcon />
											Rename
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="text-destructive focus:text-destructive"
											onSelect={() => openDelete(ws)}
										>
											<TrashIcon />
											Delete
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
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
								if (!creating) openTemplatePicker();
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

<Dialog.Root bind:open={renameOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename workspace</Dialog.Title>
			<Dialog.Description>Give this workspace a new name.</Dialog.Description>
		</Dialog.Header>
		<form
			class="flex flex-col gap-4"
			onsubmit={(event) => {
				event.preventDefault();
				if (!renameSaving) void submitRename();
			}}
		>
			<div class="flex flex-col gap-2">
				<Label for="workspace-rename-input">Name</Label>
				<Input
					id="workspace-rename-input"
					bind:value={renameValue}
					placeholder="Workspace name"
					autocomplete="off"
					disabled={renameSaving}
				/>
			</div>
			<Dialog.Footer>
				<Button
					type="button"
					variant="ghost"
					disabled={renameSaving}
					onclick={() => (renameOpen = false)}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={renameSaving || !renameValue.trim()}>
					{renameSaving ? 'Saving…' : 'Save'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete workspace</Dialog.Title>
			<Dialog.Description>
				Delete workspace "{deleteTarget?.name ?? ''}"? This removes its container, files, and chat
				history. This cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				type="button"
				variant="ghost"
				disabled={deleting}
				onclick={() => (deleteOpen = false)}
			>
				Cancel
			</Button>
			<Button
				type="button"
				variant="destructive"
				disabled={deleting}
				onclick={() => {
					void confirmDelete();
				}}
			>
				{deleting ? 'Deleting…' : 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<TemplatePickerDialog
	bind:open={templatePickerOpen}
	onCreate={createWorkspaceWithTemplate}
	{creating}
/>
