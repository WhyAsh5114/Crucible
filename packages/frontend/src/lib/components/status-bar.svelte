<script lang="ts">
	import type { WorkspaceState } from '@crucible/types';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();
</script>

<header
	class="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-4 text-xs"
>
	<div class="flex items-center gap-2">
		<span class="size-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]"></span>
		<span class="font-medium tracking-tight text-foreground">Crucible</span>
	</div>

	<div class="h-4 w-px bg-border"></div>

	<a
		href={resolve('/workspaces')}
		class="flex items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeftIcon weight="bold" />
		<span>workspaces</span>
	</a>

	<div class="h-4 w-px bg-border"></div>

	{#if workspace}
		<span class="font-mono text-muted-foreground">{workspace.name}</span>
		<code class="font-mono text-[10px] text-muted-foreground/70">{workspace.id}</code>
	{:else}
		<span class="text-muted-foreground italic">no workspace</span>
	{/if}
</header>
