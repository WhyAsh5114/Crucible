<script lang="ts">
	import type { WorkspaceState } from '@crucible/types';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { TEMPLATE_INFO } from '$lib/components/template-picker-dialog.svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();

	const tinfo = $derived(
		workspace ? (TEMPLATE_INFO.find((t) => t.id === workspace.template) ?? null) : null
	);

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyId(): Promise<void> {
		if (!workspace) return;
		try {
			await navigator.clipboard.writeText(workspace.id);
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 1200);
		} catch {
			// clipboard API unavailable — fail silently.
		}
	}

	function shortId(id: string): string {
		// Show first 6 / last 4 of the cuid so the chip stays glanceable
		// while still being recognisable when grepping logs.
		if (id.length < 12) return id;
		return `${id.slice(0, 6)}…${id.slice(-4)}`;
	}

	/**
	 * Hard-reload the workspace page. Reaching for the nuclear option here is
	 * deliberate — it's the deterministic "make everything correct again"
	 * action the user can fall back on when any of the IDE's many live
	 * subsystems (chain, preview, agent stream, terminal WebSocket, file
	 * watcher) gets into a stuck state. The page-load path re-establishes
	 * every connection from scratch and re-fetches the workspace snapshot.
	 */
	function refreshWorkspace(): void {
		if (typeof window === 'undefined') return;
		window.location.reload();
	}
</script>

<header
	class="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background pr-12 pl-4 text-xs"
>
	<!-- ── Brand ─────────────────────────────────────────────────────────── -->
	<div class="flex items-center gap-2">
		<div
			class="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground"
		>
			<CubeIcon class="size-3" weight="fill" />
		</div>
		<span class="font-medium tracking-tight text-foreground">Crucible</span>
	</div>

	<div class="h-4 w-px bg-border"></div>

	<!-- ── Back link ─────────────────────────────────────────────────────── -->
	<a
		href={resolve('/workspaces')}
		class="flex items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeftIcon weight="bold" />
		<span>workspaces</span>
	</a>

	{#if workspace}
		<div class="h-4 w-px bg-border"></div>

		<!-- ── Template badge ────────────────────────────────────────────── -->
		{#if tinfo}
			{@const TIcon = tinfo.icon}
			<Badge
				variant="outline"
				class="gap-1.5 border-primary/30 bg-primary/5 font-mono text-[10px] text-primary"
			>
				<TIcon class="size-3" weight="fill" />
				{tinfo.name}
			</Badge>
		{/if}

		<!-- ── Workspace name ────────────────────────────────────────────── -->
		<span class="font-mono font-medium text-foreground">{workspace.name}</span>

		<!-- ── Workspace ID chip with copy ───────────────────────────────── -->
		<button
			type="button"
			onclick={copyId}
			class="group flex items-center gap-1 rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
			title="Copy workspace ID"
			aria-label="Copy workspace ID"
		>
			<span>{shortId(workspace.id)}</span>
			{#if copied}
				<CheckIcon class="size-2.5 text-live" weight="bold" />
			{:else}
				<CopyIcon class="size-2.5 opacity-50 group-hover:opacity-100" />
			{/if}
		</button>
	{:else}
		<div class="h-4 w-px bg-border"></div>
		<span class="text-muted-foreground italic">no workspace</span>
	{/if}

	<!-- ── Refresh workspace ──────────────────────────────────────────────
	     Sits to the right of the breadcrumb but before the global mode
	     toggle (which is `fixed top-2 right-2`; the header uses `pr-12`
	     to reserve space for it). Hard-reloads the page, the deterministic
	     way to reset every live subsystem in one click. -->
	<button
		type="button"
		onclick={refreshWorkspace}
		class="ml-auto flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
		title="Refresh workspace"
		aria-label="Refresh workspace"
	>
		<ArrowClockwiseIcon class="size-3.5" weight="bold" />
	</button>
</header>
