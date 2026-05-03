<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { getDevtoolsStream } from '$lib/state/devtools-stream.svelte';
	import { CopyButton } from '$lib/components/ai-elements/copy-button';
	import { cn } from '$lib/utils';
	import type { DevtoolsEvent } from '@crucible/types';
	import { SvelteMap } from 'svelte/reactivity';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import XIcon from '@lucide/svelte/icons/x';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
	import ServerIcon from '@lucide/svelte/icons/server';
	import SearchIcon from '@lucide/svelte/icons/search';
	import FilterXIcon from '@lucide/svelte/icons/filter-x';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';

	interface Props {
		workspaceId: string;
		onClose: () => void;
	}

	let { workspaceId, onClose }: Props = $props();

	const stream = getDevtoolsStream();
	let selectedServer = $state<string>('all');
	let query = $state('');

	type ToolCallEvent = Extract<DevtoolsEvent, { type: 'tool_call' }>;
	type ToolResultEvent = Extract<DevtoolsEvent, { type: 'tool_result' }>;
	type ContainerEvent = Extract<DevtoolsEvent, { type: 'container' }>;

	type DevtoolsItem =
		| { kind: 'tool'; key: string; call: ToolCallEvent; result: ToolResultEvent | null }
		| { kind: 'tool_result'; key: string; event: ToolResultEvent }
		| { kind: 'container'; key: string; event: ContainerEvent };

	let serverCounts = $derived.by(() => {
		const counts = new SvelteMap<string, number>();
		for (const event of stream.events) {
			if (event.type === 'tool_call' || event.type === 'tool_result') {
				counts.set(event.server, (counts.get(event.server) ?? 0) + 1);
			}
		}
		return counts;
	});

	let servers = $derived.by(() =>
		Array.from(serverCounts.keys()).sort((left, right) => left.localeCompare(right))
	);

	let items = $derived.by(() => groupEvents(stream.events));

	let filteredItems = $derived.by(() => {
		const server = selectedServer;
		const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		return items.filter((item) => {
			if (item.kind !== 'container') {
				const eventServer = item.kind === 'tool' ? item.call.server : item.event.server;
				if (server !== 'all' && eventServer !== server) return false;
			}

			if (terms.length === 0) return true;

			return terms.every((term) => buildSearchText(item).includes(term));
		});
	});

	$effect(() => {
		if (selectedServer === 'all') return;
		if (!servers.includes(selectedServer)) selectedServer = 'all';
	});

	function retry(): void {
		stream.retry();
	}

	function clearFilters(): void {
		selectedServer = 'all';
		query = '';
	}

	function stringify(value: unknown): string {
		try {
			const json = JSON.stringify(value, null, 2);
			return json ?? 'undefined';
		} catch {
			return String(value);
		}
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
	}

	function groupEvents(events: DevtoolsEvent[]): DevtoolsItem[] {
		const grouped: DevtoolsItem[] = [];
		for (const event of events) {
			if (event.type === 'tool_call') {
				grouped.push({
					kind: 'tool',
					key: `${event.server}:${event.tool}:${event.ts}`,
					call: event,
					result: null
				});
				continue;
			}
			if (event.type === 'tool_result') {
				for (let index = grouped.length - 1; index >= 0; index -= 1) {
					const item = grouped[index];
					if (
						item.kind === 'tool' &&
						item.call.server === event.server &&
						item.call.tool === event.tool &&
						!item.result
					) {
						item.result = event;
						break;
					}
					if (item.kind !== 'tool') continue;
				}
				if (!grouped.some((item) => item.kind === 'tool' && item.result === event)) {
					grouped.push({
						kind: 'tool_result',
						key: `${event.server}:${event.tool}:${event.ts}`,
						event
					});
				}
				continue;
			}
			grouped.push({
				kind: 'container',
				key: `${event.subtype}:${event.ts}`,
				event
			});
		}
		return grouped;
	}

	function buildSearchText(item: DevtoolsItem): string {
		if (item.kind === 'tool') {
			return [
				'tool_call',
				item.call.server,
				item.call.tool,
				stringify(item.call.args),
				item.result ? stringify(item.result.result) : '',
				item.result ? String(item.result.ok) : ''
			]
				.join(' ')
				.toLowerCase();
		}
		if (item.kind === 'tool_result') {
			return ['tool_result', item.event.server, item.event.tool, stringify(item.event.result)]
				.join(' ')
				.toLowerCase();
		}
		return ['container', item.event.subtype, item.event.message].join(' ').toLowerCase();
	}

	function copyPayload(value: unknown): string {
		return stringify(value);
	}

	function itemTitle(item: DevtoolsItem): string {
		if (item.kind === 'tool') return item.call.tool;
		if (item.kind === 'tool_result') return item.event.tool;
		return item.event.subtype;
	}

	function itemServer(item: DevtoolsItem): string | null {
		if (item.kind === 'tool') return item.call.server;
		if (item.kind === 'tool_result') return item.event.server;
		return null;
	}
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	<header
		class="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3"
	>
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<WrenchIcon class="size-4 text-live" />
				<h2 class="text-sm font-medium tracking-tight text-foreground">DevTools</h2>
			</div>
			<p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
				{workspaceId} · {stream.events.length} events
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Badge
				variant="outline"
				class={cn(
					'h-7 font-mono text-[10px]',
					stream.status === 'error'
						? 'border-destructive/40 text-destructive'
						: 'border-border text-foreground'
				)}
			>
				{#if stream.status === 'connecting' || stream.status === 'reconnecting'}
					<LoaderCircleIcon class="mr-1 size-3 animate-spin text-muted-foreground" />
				{:else if stream.status === 'connected'}
					<CircleDashedIcon class="mr-1 size-3 text-live" />
				{:else if stream.status === 'cutoff'}
					<TriangleAlertIcon class="mr-1 size-3 text-foreground" />
				{:else if stream.status === 'error'}
					<TriangleAlertIcon class="mr-1 size-3 text-destructive" />
				{:else}
					<CircleDashedIcon class="mr-1 size-3 text-muted-foreground" />
				{/if}
				{stream.status === 'cutoff' ? 'stream cutoff' : stream.status}
			</Badge>
			{#if stream.events.length > 0}
				<Button
					variant="outline"
					size="sm"
					class="h-7 px-3 font-mono text-[10px] tracking-wide uppercase"
					onclick={() => stream.clear()}
				>
					<Trash2Icon class="mr-1 size-3" />
					clear
				</Button>
			{/if}
			{#if stream.status === 'error' || stream.status === 'cutoff' || stream.status === 'closed' || stream.status === 'reconnecting'}
				<Button
					variant="outline"
					size="sm"
					class="h-7 px-3 font-mono text-[10px] tracking-wide uppercase"
					onclick={retry}
				>
					<RefreshCcwIcon class="mr-1 size-3" />
					retry
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				class="text-muted-foreground hover:text-foreground"
				aria-label="Close DevTools"
				onclick={onClose}
			>
				<XIcon class="size-4" />
			</Button>
		</div>
	</header>

	<div class="shrink-0 border-b border-border bg-muted/10 px-4 py-2">
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<div
					class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
				>
					<SearchIcon class="size-3.5 text-muted-foreground" />
					<input
						bind:value={query}
						type="search"
						placeholder="Search tools, servers, results, messages"
						class="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
					/>
					{#if query || selectedServer !== 'all'}
						<Button
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-foreground"
							onclick={clearFilters}
							aria-label="Clear filters"
						>
							<FilterXIcon class="size-3.5" />
						</Button>
					{/if}
				</div>
				<div class="flex items-center gap-2 overflow-x-auto">
					<Button
						variant={selectedServer === 'all' ? 'secondary' : 'outline'}
						size="sm"
						class="h-7 gap-1.5 px-3 font-mono text-[10px] tracking-wide uppercase"
						onclick={() => (selectedServer = 'all')}
					>
						<ServerIcon class="size-3" />
						all
					</Button>
					{#each servers as server (server)}
						<Button
							variant={selectedServer === server ? 'secondary' : 'outline'}
							size="sm"
							class="h-7 gap-1.5 px-3 font-mono text-[10px] tracking-wide uppercase"
							onclick={() => (selectedServer = server)}
						>
							<ServerIcon class="size-3" />
							{server}
							<span class="text-[9px] text-muted-foreground">{serverCounts.get(server) ?? 0}</span>
						</Button>
					{/each}
				</div>
			</div>
			{#if query || selectedServer !== 'all'}
				<div class="font-mono text-[10px] text-muted-foreground">
					Showing {filteredItems.length} of {items.length} groups
				</div>
			{/if}
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-auto">
		{#if stream.status === 'error' && filteredItems.length === 0}
			<EmptyState
				variant="degraded"
				title="Devtools stream failed"
				description={stream.error ?? 'The devtools event stream could not be read.'}
			>
				{#snippet actions()}
					<Button variant="secondary" onclick={retry}>
						<RefreshCcwIcon class="mr-2 size-4" />
						Retry
					</Button>
				{/snippet}
			</EmptyState>
		{:else if stream.status === 'cutoff' && filteredItems.length === 0}
			<EmptyState
				variant="degraded"
				title="Devtools stream cut off"
				description="The SSE connection ended before any events were rendered. Retry to reconnect."
			>
				{#snippet actions()}
					<Button variant="secondary" onclick={retry}>
						<RefreshCcwIcon class="mr-2 size-4" />
						Retry
					</Button>
				{/snippet}
			</EmptyState>
		{:else if filteredItems.length === 0}
			<EmptyState
				title="Listening for devtools events"
				description={query.trim().length > 0 || selectedServer !== 'all'
					? 'No devtools groups match the current filters.'
					: 'No devtools events have arrived yet. Leave this tab open while MCP servers start work.'}
			>
				{#snippet icon()}
					<div class="flex items-center justify-center">
						{#if stream.status === 'connecting' || stream.status === 'reconnecting'}
							<LoaderCircleIcon class="size-8 animate-spin text-live" />
						{:else}
							<CodeXmlIcon class="size-8 text-muted-foreground/60" />
						{/if}
					</div>
				{/snippet}
			</EmptyState>
		{:else}
			<ol class="flex flex-col">
				{#each filteredItems.reverse() as item, index (item.key + ':' + index)}
					<li>
						<article
							class="group flex flex-col gap-1.5 border-b border-border/60 px-4 py-3 transition-colors hover:bg-muted/30"
						>
							<header
								class="flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
							>
								<span
									class={cn(
										'font-mono',
										item.kind === 'tool' && item.result
											? 'text-live'
											: item.kind === 'tool_result'
												? 'text-destructive'
												: 'text-foreground'
									)}
								>
									{item.kind === 'tool' && item.result
										? 'tool_call/result'
										: item.kind === 'tool_result'
											? 'tool_result'
											: 'container'}
								</span>
								{#if itemServer(item)}
									<span
										class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase"
										>{itemServer(item)}</span
									>
									<span class="font-mono text-muted-foreground/70">{itemTitle(item)}</span>
								{/if}
								<span class="ml-auto font-mono tabular-nums"
									>{formatTime(item.kind === 'tool' ? item.call.ts : item.event.ts)}</span
								>
							</header>
							<div class="text-sm leading-relaxed text-foreground">
								{#if item.kind === 'tool'}
									<div class="flex flex-col gap-2">
										<div class="flex items-center justify-between gap-2">
											<p class="text-xs text-muted-foreground">call</p>
											<CopyButton
												text={copyPayload(item.call)}
												variant="ghost"
												size="icon-xs"
												class="text-muted-foreground hover:text-foreground"
												aria-label="Copy tool call payload"
											/>
										</div>
										<pre
											class="overflow-x-auto rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-foreground">{stringify(
												item.call
											)}</pre>
									</div>
									{#if item.result}
										<div class="flex flex-col gap-2 border-t border-border/60 pt-2">
											<div
												class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
											>
												<div class="flex items-center gap-2">
													<span>{item.result.ok ? 'result' : 'error'}</span>
													<span
														class={cn(
															'rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase',
															item.result.ok
																? 'bg-live/10 text-live'
																: 'bg-destructive/10 text-destructive'
														)}
													>
														{item.result.durationMs}ms
													</span>
												</div>
												<CopyButton
													text={copyPayload(item.result)}
													variant="ghost"
													size="icon-xs"
													class="text-muted-foreground hover:text-foreground"
													aria-label="Copy tool result payload"
												/>
											</div>
											<pre
												class="overflow-x-auto rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-foreground">{stringify(
													item.result
												)}</pre>
										</div>
									{/if}
								{:else if item.kind === 'tool_result'}
									<div class="flex flex-col gap-2">
										<div
											class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
										>
											<div class="flex items-center gap-2">
												<span>{item.event.ok ? 'result' : 'error'}</span>
												<span
													class={cn(
														'rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase',
														item.event.ok
															? 'bg-live/10 text-live'
															: 'bg-destructive/10 text-destructive'
													)}
												>
													{item.event.durationMs}ms
												</span>
											</div>
											<CopyButton
												text={copyPayload(item.event)}
												variant="ghost"
												size="icon-xs"
												class="text-muted-foreground hover:text-foreground"
												aria-label="Copy tool result payload"
											/>
										</div>
										<pre
											class="overflow-x-auto rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-foreground">{stringify(
												item.event
											)}</pre>
									</div>
								{:else}
									<div class="flex flex-col gap-2">
										<div
											class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
										>
											<p>{item.event.subtype}</p>
											<CopyButton
												text={copyPayload(item.event)}
												variant="ghost"
												size="icon-xs"
												class="text-muted-foreground hover:text-foreground"
												aria-label="Copy container event payload"
											/>
										</div>
										<p class="whitespace-pre-wrap text-foreground">{item.event.message}</p>
										<pre
											class="overflow-x-auto rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-foreground">{stringify(
												item.event
											)}</pre>
									</div>
								{/if}
							</div>
						</article>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</section>
