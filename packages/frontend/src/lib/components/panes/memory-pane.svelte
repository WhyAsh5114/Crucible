<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { MemoryPattern } from '@crucible/types';
	import { workspaceClient } from '$lib/api/workspace';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { cn } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import BrainIcon from '@lucide/svelte/icons/brain';
	import ListIcon from '@lucide/svelte/icons/list';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	interface Props {
		workspaceId: string;
	}

	let { workspaceId }: Props = $props();

	type Scope = 'all' | 'local' | 'mesh';
	type View = 'list' | 'graph';

	let scopeFilter = $state<Scope>('all');
	let view = $state<View>('list');
	let allPatterns = $state<MemoryPattern[]>([]);
	let loading = $state(false);
	let embeddings = $state(new Map<string, number[]>());
	let embedLoading = $state(false);
	let embedUnavailable = $state(false);
	let purging = $state(false);
	let confirmPurge = $state(false);
	let hoveredId = $state<string | null>(null);
	let selectedId = $state<string | null>(null);
	let graphW = $state(800);
	let graphH = $state(600);

	const filteredPatterns = $derived(
		scopeFilter === 'all' ? allPatterns : allPatterns.filter((p) => p.scope === scopeFilter)
	);
	const localCount = $derived(allPatterns.filter((p) => p.scope === 'local').length);
	const meshCount = $derived(allPatterns.filter((p) => p.scope === 'mesh').length);
	const selectedPattern = $derived(
		selectedId ? (allPatterns.find((p) => p.id === selectedId) ?? null) : null
	);

	// ── Force simulation ─────────────────────────────────────────────────────

	type SimNode = {
		id: string;
		x: number;
		y: number;
		vx: number;
		vy: number;
		scope: 'local' | 'mesh';
		revertSignature: string;
	};
	type SimEdge = { source: string; target: string; weight: number };

	const SIM_K = 5000;
	const SIM_SPRING = 0.06;
	const SIM_DAMP = 0.72;
	const SIM_GRAVITY = 0.002;
	const SIM_TPF = 4;
	const SIM_MAX_FRAMES = 200;

	let simNodes: SimNode[] = [];
	let simEdgesRaw: SimEdge[] = [];
	let rafId: number | null = null;
	let simFrame = 0;

	let graphNodes = $state<SimNode[]>([]);
	let graphEdges = $state<SimEdge[]>([]);

	function cosine(a: number[], b: number[]): number {
		let dot = 0,
			na = 0,
			nb = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i]! * b[i]!;
			na += a[i]! * a[i]!;
			nb += b[i]! * b[i]!;
		}
		return dot / (Math.sqrt(na * nb) || 1);
	}

	function deriveEdges(patterns: MemoryPattern[], vecs: Map<string, number[]>): SimEdge[] {
		const edges: SimEdge[] = [];
		for (let i = 0; i < patterns.length; i++) {
			for (let j = i + 1; j < patterns.length; j++) {
				const va = vecs.get(patterns[i]!.id);
				const vb = vecs.get(patterns[j]!.id);
				if (va && vb) {
					// Both have embedding vectors — use cosine similarity.
					const sim = cosine(va, vb);
					if (sim >= 0.72) {
						edges.push({ source: patterns[i]!.id, target: patterns[j]!.id, weight: sim });
					}
				} else {
					// One or both patterns lack an embedding (e.g. mesh patterns whose
					// vectors weren't fetched) — fall back to exact revertSignature match.
					if (patterns[i]!.revertSignature === patterns[j]!.revertSignature) {
						edges.push({ source: patterns[i]!.id, target: patterns[j]!.id, weight: 1.0 });
					}
				}
			}
		}
		return edges;
	}

	function stopSim(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function tickSim(w: number, h: number): void {
		const cx = w / 2;
		const cy = h / 2;
		const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

		for (const n of simNodes) {
			n.vx *= SIM_DAMP;
			n.vy *= SIM_DAMP;
		}

		for (let i = 0; i < simNodes.length; i++) {
			for (let j = i + 1; j < simNodes.length; j++) {
				const ni = simNodes[i]!;
				const nj = simNodes[j]!;
				const dx = ni.x - nj.x;
				const dy = ni.y - nj.y;
				const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
				const f = SIM_K / (dist * dist);
				ni.vx += (dx / dist) * f;
				ni.vy += (dy / dist) * f;
				nj.vx -= (dx / dist) * f;
				nj.vy -= (dy / dist) * f;
			}
		}

		for (const edge of simEdgesRaw) {
			const s = nodeMap.get(edge.source);
			const t = nodeMap.get(edge.target);
			if (!s || !t) continue;
			const dx = t.x - s.x;
			const dy = t.y - s.y;
			const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
			const f = (dist - 120) * SIM_SPRING * edge.weight;
			s.vx += (dx / dist) * f;
			s.vy += (dy / dist) * f;
			t.vx -= (dx / dist) * f;
			t.vy -= (dy / dist) * f;
		}

		for (const n of simNodes) {
			n.vx += (cx - n.x) * SIM_GRAVITY;
			n.vy += (cy - n.y) * SIM_GRAVITY;
			n.x = Math.max(20, Math.min(w - 20, n.x + n.vx));
			n.y = Math.max(20, Math.min(h - 20, n.y + n.vy));
		}
	}

	function initSim(patterns: MemoryPattern[], edges: SimEdge[], w: number, h: number): void {
		stopSim();
		simFrame = 0;
		const cx = w / 2;
		const cy = h / 2;
		simNodes = patterns.map((p) => ({
			id: p.id,
			x: cx + (Math.random() - 0.5) * 280,
			y: cy + (Math.random() - 0.5) * 280,
			vx: 0,
			vy: 0,
			scope: p.scope,
			revertSignature: p.revertSignature
		}));
		simEdgesRaw = edges;
		graphEdges = edges;

		function frame() {
			for (let i = 0; i < SIM_TPF; i++) tickSim(w, h);
			graphNodes = simNodes.map((n) => ({ ...n }));
			simFrame++;
			if (simFrame < SIM_MAX_FRAMES) {
				rafId = requestAnimationFrame(frame);
			} else {
				rafId = null;
			}
		}
		rafId = requestAnimationFrame(frame);
	}

	// ── Data loading ─────────────────────────────────────────────────────────

	async function load(): Promise<void> {
		loading = true;
		allPatterns = [];
		embeddings = new Map();
		embedUnavailable = false;
		try {
			allPatterns = await workspaceClient.listMemoryPatterns(workspaceId);
		} catch (err) {
			toast.error('Failed to load patterns', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			loading = false;
		}
	}

	async function loadEmbeddings(): Promise<void> {
		if (allPatterns.length === 0) return;
		embedLoading = true;
		try {
			const result = await workspaceClient.embedMemoryPatterns(workspaceId);
			if (result.length === 0) {
				embedUnavailable = true;
			} else {
				embeddings = new Map(result.map((e) => [e.id, e.vector]));
			}
		} catch {
			embedUnavailable = true;
		} finally {
			embedLoading = false;
		}
	}

	async function doPurge(): Promise<void> {
		purging = true;
		try {
			const scopeArg = scopeFilter === 'all' ? undefined : scopeFilter;
			const deleted = await workspaceClient.purgeMemory(workspaceId, scopeArg);
			toast.success(`Purged ${deleted} pattern${deleted === 1 ? '' : 's'}`);
			confirmPurge = false;
			selectedId = null;
			await load();
		} catch (err) {
			toast.error('Purge failed', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			purging = false;
		}
	}

	// ── Reactive effects ─────────────────────────────────────────────────────

	$effect(() => {
		const id = workspaceId;
		loading = true;
		allPatterns = [];
		embeddings = new Map();
		embedUnavailable = false;
		void workspaceClient
			.listMemoryPatterns(id)
			.then((patterns) => {
				allPatterns = patterns;
			})
			.catch((err: unknown) => {
				toast.error('Failed to load patterns', {
					description: err instanceof Error ? err.message : String(err)
				});
			})
			.finally(() => {
				loading = false;
			});
	});

	$effect(() => {
		if (view !== 'graph' || allPatterns.length === 0 || embedLoading || embedUnavailable) return;
		if (embeddings.size > 0) return;
		void loadEmbeddings();
	});

	$effect(() => {
		if (view !== 'graph' || loading || filteredPatterns.length === 0) {
			stopSim();
			return;
		}
		const w = graphW || 800;
		const h = graphH || 600;
		const edges = deriveEdges(filteredPatterns, embeddings);
		initSim(filteredPatterns, edges, w, h);
		return () => stopSim();
	});

	onDestroy(() => stopSim());

	// ── Helpers ───────────────────────────────────────────────────────────────

	function timeAgo(ms: number): string {
		const diff = Date.now() - ms;
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	function patchLines(patch: string | null | undefined, n = 5): string[] {
		if (!patch) return [];
		return patch
			.split('\n')
			.filter((l) => l.startsWith('+') || l.startsWith('-'))
			.slice(0, n);
	}

	function truncate(s: string, n: number): string {
		return s.length > n ? s.slice(0, n) + '…' : s;
	}

	function shortId(id: string): string {
		return id.slice(0, 12);
	}

	const tooltipNode = $derived(
		hoveredId ? (graphNodes.find((n) => n.id === hoveredId) ?? null) : null
	);
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	<!-- ── Header ── -->
	<header
		class="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3"
	>
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<BrainIcon class="size-4 text-indigo-400" />
				<h2 class="text-sm font-medium tracking-tight text-foreground">Memory</h2>
			</div>
			<p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
				{workspaceId} · {filteredPatterns.length}
				{filteredPatterns.length === 1 ? 'pattern' : 'patterns'}
			</p>
		</div>
		<Button
			variant="outline"
			size="sm"
			class="h-7 px-3 font-mono text-[10px] tracking-wide uppercase"
			onclick={() => void load()}
			disabled={loading}
		>
			{#if loading}
				<LoaderCircleIcon class="mr-1 size-3 animate-spin" />
			{:else}
				<RefreshCcwIcon class="mr-1 size-3" />
			{/if}
			refresh
		</Button>
	</header>

	<!-- ── Scope + action bar ── -->
	<div
		class="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/10 px-4 py-2"
	>
		<div class="flex items-center gap-1">
			<Button
				variant={scopeFilter === 'all' ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 gap-1.5 px-3 font-mono text-[10px] tracking-wide uppercase"
				onclick={() => (scopeFilter = 'all')}
			>
				all
				<span class="text-[9px] text-muted-foreground">{allPatterns.length}</span>
			</Button>
			<Button
				variant={scopeFilter === 'local' ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 gap-1.5 px-3 font-mono text-[10px] tracking-wide uppercase"
				onclick={() => (scopeFilter = 'local')}
			>
				<HardDriveIcon class="size-3 text-indigo-400" />
				local
				<span class="text-[9px] text-muted-foreground">{localCount}</span>
			</Button>
			<Button
				variant={scopeFilter === 'mesh' ? 'secondary' : 'ghost'}
				size="sm"
				class="h-7 gap-1.5 px-3 font-mono text-[10px] tracking-wide uppercase"
				onclick={() => (scopeFilter = 'mesh')}
			>
				<GlobeIcon class="size-3 text-amber-400" />
				mesh
				<span class="text-[9px] text-muted-foreground">{meshCount}</span>
			</Button>
		</div>

		<div class="flex items-center gap-2">
			<!-- View toggle -->
			<div class="flex items-center overflow-hidden rounded-md border border-border">
				<Button
					variant="ghost"
					size="sm"
					class={cn(
						'h-6 rounded-none px-2.5 font-mono text-[10px]',
						view === 'list' && 'bg-muted text-foreground'
					)}
					onclick={() => (view = 'list')}
					aria-label="List view"
				>
					<ListIcon class="size-3" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class={cn(
						'h-6 rounded-none border-l border-border px-2.5 font-mono text-[10px]',
						view === 'graph' && 'bg-muted text-foreground'
					)}
					onclick={() => (view = 'graph')}
					aria-label="Graph view"
				>
					<NetworkIcon class="size-3" />
				</Button>
			</div>

			<!-- Purge control -->
			{#if confirmPurge}
				<div
					class="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-0.5"
				>
					<span class="font-mono text-[10px] text-muted-foreground">
						delete {scopeFilter === 'all' ? 'all' : scopeFilter}?
					</span>
					<Button
						variant="destructive"
						size="sm"
						class="h-5 px-2 font-mono text-[10px]"
						onclick={doPurge}
						disabled={purging}
					>
						{#if purging}
							<LoaderCircleIcon class="size-2.5 animate-spin" />
						{:else}
							yes
						{/if}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-5 px-2 font-mono text-[10px] text-muted-foreground"
						onclick={() => (confirmPurge = false)}
					>
						no
					</Button>
				</div>
			{:else}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 gap-1.5 px-2.5 font-mono text-[10px] tracking-wide text-muted-foreground/60 uppercase hover:text-destructive"
					onclick={() => (confirmPurge = true)}
					disabled={filteredPatterns.length === 0}
				>
					<Trash2Icon class="size-3" />
					purge
				</Button>
			{/if}
		</div>
	</div>

	<!-- ── Graph status bar ── -->
	{#if view === 'graph'}
		<div class="flex shrink-0 items-center gap-2 border-b border-border/30 bg-muted/5 px-4 py-1">
			{#if embedLoading}
				<LoaderCircleIcon class="size-3 animate-spin text-muted-foreground/50" />
				<span class="font-mono text-[10px] text-muted-foreground/60">computing embeddings…</span>
			{:else if embeddings.size > 0}
				<CheckCircle2Icon class="size-3 text-live" />
				<span class="font-mono text-[10px] text-muted-foreground/70"
					>semantic edges · {embeddings.size} vectors</span
				>
			{:else if embedUnavailable}
				<SparklesIcon class="size-3 text-amber-500/60" />
				<span class="font-mono text-[10px] text-amber-500/60"
					>signature grouping · set OPENAI_BASE_URL for semantic edges</span
				>
			{:else}
				<span class="font-mono text-[10px] text-muted-foreground/40">signature grouping</span>
			{/if}
			<div class="ml-auto flex items-center gap-3">
				<span class="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/50">
					<span class="inline-block size-2 rounded-full bg-indigo-500/80"></span>local
				</span>
				<span class="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/50">
					<span class="inline-block size-2 rounded-full bg-amber-500/80"></span>mesh
				</span>
			</div>
		</div>
	{/if}

	<!-- ── Main content ── -->
	<div class="min-h-0 flex-1 overflow-hidden">
		{#if loading}
			<EmptyState title="Loading patterns…">
				{#snippet icon()}
					<LoaderCircleIcon class="size-8 animate-spin text-muted-foreground/40" />
				{/snippet}
			</EmptyState>
		{:else if filteredPatterns.length === 0}
			<EmptyState
				title={scopeFilter === 'mesh'
					? 'No mesh patterns'
					: scopeFilter === 'local'
						? 'No local patterns'
						: 'No patterns yet'}
				description="The agent stores a pattern each time it successfully repairs a contract revert."
			>
				{#snippet icon()}
					<BrainIcon class="size-8 text-muted-foreground/30" />
				{/snippet}
			</EmptyState>
		{:else if view === 'list'}
			<!-- ── List view ── -->
			<div class="h-full overflow-auto">
				<ol class="flex flex-col">
					{#each filteredPatterns as pattern (pattern.id)}
						<li>
							<div
								class={cn(
									'group flex cursor-pointer flex-col gap-2 border-b border-border/50 px-4 py-3 transition-colors hover:bg-muted/20',
									selectedId === pattern.id && 'bg-muted/30'
								)}
								role="button"
								tabindex="0"
								onclick={() => (selectedId = selectedId === pattern.id ? null : pattern.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter') selectedId = selectedId === pattern.id ? null : pattern.id;
								}}
							>
								<div class="flex items-center justify-between gap-2">
									<div class="flex items-center gap-2">
										<Badge
											variant="outline"
											class={cn(
												'h-4 gap-1 px-1.5 font-mono text-[9px] tracking-wide uppercase',
												pattern.scope === 'local'
													? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300'
													: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300'
											)}
										>
											{#if pattern.scope === 'local'}
												<HardDriveIcon class="size-2.5" />
											{:else}
												<GlobeIcon class="size-2.5" />
											{/if}
											{pattern.scope}
										</Badge>
										<span class="font-mono text-[10px] text-muted-foreground/50">
											{shortId(pattern.id)}
										</span>
									</div>
									<span class="shrink-0 font-mono text-[10px] text-muted-foreground/40">
										{timeAgo(pattern.createdAt)}
									</span>
								</div>

								<p class="font-mono text-[11px] leading-snug font-medium text-foreground">
									{truncate(pattern.revertSignature, 72)}
								</p>

								{#if patchLines(pattern.patch).length > 0}
									<pre
										class="overflow-x-auto rounded bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed">{#each patchLines(pattern.patch) as line, i (i)}<span
												class={cn(
													'block',
													line.startsWith('+')
														? 'text-green-600 dark:text-green-400'
														: 'text-red-600 dark:text-red-400'
												)}>{line}</span
											>{/each}</pre>
								{/if}

								<div class="flex items-center gap-3 font-mono text-[10px] text-muted-foreground/40">
									<span>◎ {truncate(pattern.provenance.authorNode, 24)}</span>
									<span class="ml-auto truncate text-right"
										>✓ {pattern.verificationReceipt.slice(0, 12)}…</span
									>
								</div>
							</div>
						</li>
					{/each}
				</ol>
			</div>
		{:else}
			<!-- ── Graph view ── -->
			<div
				class="relative h-full overflow-hidden bg-card dark:bg-[#080a0d]"
				bind:clientWidth={graphW}
				bind:clientHeight={graphH}
			>
				{#if graphNodes.length > 0}
					<svg class="absolute inset-0 size-full" aria-label="Pattern knowledge graph">
						<defs>
							<filter id="mem-glow-local" x="-80%" y="-80%" width="260%" height="260%">
								<feGaussianBlur stdDeviation="4" result="blur" />
								<feMerge>
									<feMergeNode in="blur" />
									<feMergeNode in="SourceGraphic" />
								</feMerge>
							</filter>
							<filter id="mem-glow-mesh" x="-80%" y="-80%" width="260%" height="260%">
								<feGaussianBlur stdDeviation="4" result="blur" />
								<feMerge>
									<feMergeNode in="blur" />
									<feMergeNode in="SourceGraphic" />
								</feMerge>
							</filter>
							<pattern
								id="mem-grid"
								x="0"
								y="0"
								width="32"
								height="32"
								patternUnits="userSpaceOnUse"
							>
								<circle cx="1" cy="1" r="0.6" fill="hsl(var(--foreground) / 0.05)" />
							</pattern>
						</defs>

						<rect width="100%" height="100%" fill="url(#mem-grid)" />

						<!-- Edges -->
						{#each graphEdges as edge (`${edge.source}-${edge.target}`)}
							{@const s = graphNodes.find((n) => n.id === edge.source)}
							{@const t = graphNodes.find((n) => n.id === edge.target)}
							{#if s && t}
								<line
									x1={s.x}
									y1={s.y}
									x2={t.x}
									y2={t.y}
									style="stroke: hsl(var(--foreground) / {(edge.weight * 0.25).toFixed(2)})"
									stroke-width={edge.weight * 1.5}
								/>
							{/if}
						{/each}

						<!-- Nodes -->
						{#each graphNodes as node (node.id)}
							{@const isHovered = hoveredId === node.id}
							{@const isSelected = selectedId === node.id}
							{@const r = isSelected ? 11 : isHovered ? 10 : 8}
							<g
								transform="translate({node.x},{node.y})"
								style="cursor: pointer"
								role="button"
								tabindex="0"
								aria-label={node.revertSignature}
								onmouseenter={() => (hoveredId = node.id)}
								onmouseleave={() => (hoveredId = null)}
								onclick={() => (selectedId = isSelected ? null : node.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter') selectedId = isSelected ? null : node.id;
								}}
							>
								{#if isSelected}
									<circle
										r="16"
										fill="none"
										stroke={node.scope === 'local'
											? 'rgba(99,102,241,0.35)'
											: 'rgba(245,158,11,0.35)'}
										stroke-width="1.5"
									/>
								{/if}
								<circle
									{r}
									fill={node.scope === 'local' ? 'rgba(99,102,241,0.9)' : 'rgba(245,158,11,0.9)'}
									filter={node.scope === 'local' ? 'url(#mem-glow-local)' : 'url(#mem-glow-mesh)'}
								/>
							</g>
						{/each}
					</svg>

					<!-- Hover tooltip -->
					{#if tooltipNode}
						<div
							class="pointer-events-none absolute z-20 max-w-56 rounded-lg border border-border/60 bg-popover/95 px-3 py-2 shadow-xl backdrop-blur-sm"
							style="left: {Math.min(tooltipNode.x + 18, graphW - 230)}px; top: {Math.max(
								tooltipNode.y - 44,
								4
							)}px"
						>
							<p class="font-mono text-[10px] leading-snug font-semibold text-foreground">
								{truncate(tooltipNode.revertSignature, 52)}
							</p>
							<p class="mt-0.5 font-mono text-[9px] text-muted-foreground">
								{shortId(tooltipNode.id)} · {tooltipNode.scope}
							</p>
						</div>
					{/if}

					<!-- Selected detail panel -->
					{#if selectedPattern}
						<div
							class="absolute top-0 right-0 flex h-full w-72 flex-col border-l border-border bg-background/95 backdrop-blur-sm"
						>
							<div
								class="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2"
							>
								<span class="font-mono text-[11px] font-medium text-foreground">Pattern detail</span
								>
								<Button
									variant="ghost"
									size="icon-sm"
									class="text-muted-foreground hover:text-foreground"
									onclick={() => (selectedId = null)}
								>
									<XIcon class="size-3.5" />
								</Button>
							</div>
							<div class="min-h-0 flex-1 overflow-auto px-3 py-3">
								<dl class="flex flex-col gap-3.5 font-mono text-[11px]">
									<div>
										<dt class="text-[9px] tracking-wide text-muted-foreground/50 uppercase">
											Scope
										</dt>
										<dd class="mt-1">
											<Badge
												variant="outline"
												class={cn(
													'h-4 gap-1 px-1.5 text-[9px] uppercase',
													selectedPattern.scope === 'local'
														? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300'
														: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300'
												)}
											>
												{#if selectedPattern.scope === 'local'}
													<HardDriveIcon class="size-2.5" />
												{:else}
													<GlobeIcon class="size-2.5" />
												{/if}
												{selectedPattern.scope}
											</Badge>
										</dd>
									</div>
									<div>
										<dt class="text-[9px] tracking-wide text-muted-foreground/50 uppercase">
											Revert signature
										</dt>
										<dd class="mt-1 leading-snug text-foreground">
											{selectedPattern.revertSignature}
										</dd>
									</div>
									<div>
										<dt class="text-[9px] tracking-wide text-muted-foreground/50 uppercase">
											Patch
										</dt>
										<dd class="mt-1">
											<pre
												class="overflow-x-auto rounded bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed">{#each patchLines(selectedPattern.patch, 10) as line, i (i)}<span
														class={cn(
															'block',
															line.startsWith('+')
																? 'text-green-600 dark:text-green-400'
																: 'text-red-600 dark:text-red-400'
														)}>{line}</span
													>{/each}</pre>
										</dd>
									</div>
									<div>
										<dt class="text-[9px] tracking-wide text-muted-foreground/50 uppercase">
											Node
										</dt>
										<dd class="mt-1 text-muted-foreground">
											{selectedPattern.provenance.authorNode}
										</dd>
									</div>
									<div>
										<dt class="text-[9px] tracking-wide text-muted-foreground/50 uppercase">
											Created
										</dt>
										<dd class="mt-1 text-muted-foreground">{timeAgo(selectedPattern.createdAt)}</dd>
									</div>
									<div>
										<dt class="text-[9px] tracking-wide text-muted-foreground/50 uppercase">
											Receipt
										</dt>
										<dd class="mt-1 break-all text-muted-foreground/60">
											{selectedPattern.verificationReceipt}
										</dd>
									</div>
								</dl>
							</div>
						</div>
					{/if}
				{:else if !loading}
					<!-- Graph with no nodes (shouldn't reach here normally) -->
					<div
						class="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground/30"
					>
						initializing…
					</div>
				{/if}
			</div>
		{/if}
	</div>
</section>
