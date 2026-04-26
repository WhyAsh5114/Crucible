<script lang="ts">
	import type { WorkspaceState } from '@crucible/types';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';

	interface Props {
		workspace: WorkspaceState | null;
		fixtureMode: boolean;
	}

	let { workspace, fixtureMode }: Props = $props();
	const stream = getAgentStream();

	type Tone = 'idle' | 'live' | 'degraded';

	let chainPill = $derived<{ label: string; tone: Tone }>(
		workspace?.chainState
			? { label: `chain · block ${workspace.chainState.blockNumber}`, tone: 'live' }
			: { label: 'chain · idle', tone: 'idle' }
	);

	let previewPill = $derived<{ label: string; tone: Tone }>(
		workspace?.previewUrl
			? { label: 'preview · ready', tone: 'live' }
			: { label: 'preview · idle', tone: 'degraded' }
	);

	let terminalPill = $derived<{ label: string; tone: Tone }>(
		workspace?.terminalSessionId
			? { label: 'terminal · attached', tone: 'live' }
			: { label: 'terminal · idle', tone: 'degraded' }
	);

	let agentPill = $derived<{ label: string; tone: Tone }>(
		stream.status === 'streaming'
			? { label: 'agent · streaming', tone: 'live' }
			: stream.status === 'done'
				? { label: 'agent · done', tone: 'idle' }
				: stream.status === 'error'
					? { label: 'agent · error', tone: 'degraded' }
					: { label: 'agent · idle', tone: 'idle' }
	);

	const toneTextClass: Record<Tone, string> = {
		idle: 'text-muted-foreground',
		live: 'text-live',
		degraded: 'text-muted-foreground'
	};

	const toneDotClass: Record<Tone, string> = {
		idle: 'bg-muted-foreground/30',
		live: 'bg-live shadow-[0_0_6px_var(--live)]',
		degraded: 'bg-muted-foreground/50'
	};

	const toneBorderClass: Record<Tone, string> = {
		idle: 'border-border',
		live: 'border-live/40',
		degraded: 'border-border'
	};
</script>

<header
	class="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-4 text-xs"
>
	<div class="flex items-center gap-2">
		<span class="size-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]"></span>
		<span class="font-medium tracking-tight text-foreground">Crucible</span>
	</div>

	<div class="h-4 w-px bg-border"></div>

	{#if workspace}
		<span class="font-mono text-muted-foreground">{workspace.name}</span>
		<code class="font-mono text-[10px] text-muted-foreground/70">{workspace.id}</code>
	{:else}
		<span class="text-muted-foreground italic">no workspace</span>
	{/if}

	<div class="ml-auto flex items-center gap-1.5">
		{#each [chainPill, previewPill, terminalPill, agentPill] as pill (pill.label)}
			<Badge
				variant="outline"
				class={cn(
					'h-6 font-mono text-[10px]',
					toneTextClass[pill.tone],
					toneBorderClass[pill.tone]
				)}
			>
				<span class={cn('mr-1.5 size-1.5 rounded-full', toneDotClass[pill.tone])}></span>
				{pill.label}
			</Badge>
		{/each}

		{#if fixtureMode}
			<Badge variant="outline" class="h-6 font-mono text-[10px] text-muted-foreground">
				fixture mode
			</Badge>
		{/if}
	</div>
</header>
