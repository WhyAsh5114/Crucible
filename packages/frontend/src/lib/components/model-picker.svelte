<script lang="ts">
	import { onMount } from 'svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { workspaceClient, type ModelsResponse } from '$lib/api/workspace';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import SearchIcon from '@lucide/svelte/icons/search';

	export type ModelSelection =
		| { provider: '0g'; model: string }
		| { provider: 'openai'; model: string };

	interface Props {
		value: ModelSelection;
		onchange: (sel: ModelSelection) => void;
	}

	let { value, onchange }: Props = $props();

	let models = $state<ModelsResponse | null>(null);
	let loading = $state(true);
	let search = $state('');

	onMount(async () => {
		try {
			models = await workspaceClient.fetchModels();
			// If 0G is unconfigured but OpenAI is, default to first OpenAI model.
			if (!models.og && models.openai && models.openai.length > 0) {
				onchange({ provider: 'openai', model: models.openai[0] });
			}
		} catch {
			// Silently degrade — the picker will show what's available.
		} finally {
			loading = false;
		}
	});

	const label = $derived(
		value.provider === '0g'
			? shortModelName(value.model)
			: value.model
				? shortModelName(value.model)
				: 'OpenAI fallback'
	);

	const providerTag = $derived(value.provider === '0g' ? '0G' : 'OpenAI');

	function shortModelName(m: string): string {
		// "org/model-name-7b-instruct" → "model-name-7b"
		const base = m.includes('/') ? m.split('/').at(-1)! : m;
		// Drop trailing "-instruct" / "-chat" / "-preview" / "-latest" suffixes
		return base.replace(/-(instruct|chat|preview|latest)$/i, '');
	}

	function matchesSearch(m: string): boolean {
		if (!search.trim()) return true;
		const q = search.trim().toLowerCase();
		return m.toLowerCase().includes(q) || shortModelName(m).toLowerCase().includes(q);
	}

	const RECOMMENDED = ['glm-5', 'minimax-b2.5', 'deepseek-v4-pro'];
	function isRecommended(m: string): boolean {
		const lower = m.toLowerCase();
		return RECOMMENDED.some((s) => lower.includes(s));
	}
</script>

<DropdownMenu.DropdownMenu
	onOpenChange={(open) => {
		if (!open) search = '';
	}}
>
	<DropdownMenu.DropdownMenuTrigger
		class="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
	>
		{#if value.provider === '0g'}
			<SparklesIcon class="size-3 text-amber-400" />
		{/if}
		<span class="text-muted-foreground">{providerTag}</span>
		<span class="max-w-24 truncate text-foreground">{label}</span>
		<ChevronDownIcon class="size-3 text-muted-foreground" />
	</DropdownMenu.DropdownMenuTrigger>

	<DropdownMenu.DropdownMenuPortal>
		<DropdownMenu.DropdownMenuContent
			align="start"
			class="max-h-[60vh] w-64 overflow-y-auto font-mono"
		>
			<!-- Search input -->
			<div class="flex items-center gap-1.5 border-b px-2 py-1.5">
				<SearchIcon class="size-3 shrink-0 text-muted-foreground" />
				<input
					type="text"
					placeholder="Search models…"
					bind:value={search}
					onkeydown={(e) => e.stopPropagation()}
					class="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
				/>
			</div>

			<!-- 0G section -->
			{#if loading || models?.og}
				<DropdownMenu.DropdownMenuGroup>
					<DropdownMenu.DropdownMenuGroupHeading class="flex items-center gap-1.5 text-[10px]">
						<SparklesIcon class="size-3 text-amber-400" />
						0G Compute
						<span
							class="ml-auto rounded px-1 py-px text-[9px] font-normal text-amber-400/80 ring-1 ring-amber-400/30"
						>
							testnet
						</span>
					</DropdownMenu.DropdownMenuGroupHeading>

					{#if loading}
						<DropdownMenu.DropdownMenuItem disabled class="text-[11px] text-muted-foreground">
							Loading…
						</DropdownMenu.DropdownMenuItem>
					{:else if models?.og}
						{@const ogModel = models.og.model}
						{#if matchesSearch(ogModel)}
							<DropdownMenu.DropdownMenuItem
								class="flex items-center justify-between text-[11px]"
								onclick={() => onchange({ provider: '0g', model: ogModel })}
							>
								<span class="truncate">{shortModelName(ogModel)}</span>
								{#if value.provider === '0g'}
									<CheckIcon class="ml-2 size-3 shrink-0 text-amber-400" />
								{/if}
							</DropdownMenu.DropdownMenuItem>
							<p class="px-2 pt-0.5 pb-1 text-[10px] text-muted-foreground/60">
								Testnet: good for simple tasks. Use OpenAI for complex work.
							</p>
						{/if}
					{/if}
				</DropdownMenu.DropdownMenuGroup>
			{/if}

			<!-- OpenAI-compatible section -->
			{#if models?.openai !== null}
				<DropdownMenu.DropdownMenuSeparator />
				<DropdownMenu.DropdownMenuGroup>
					<DropdownMenu.DropdownMenuGroupHeading class="text-[10px]">
						OpenAI-compatible fallback
					</DropdownMenu.DropdownMenuGroupHeading>

					{#if loading}
						<DropdownMenu.DropdownMenuItem disabled class="text-[11px] text-muted-foreground">
							Loading…
						</DropdownMenu.DropdownMenuItem>
					{:else if models?.openai && models.openai.length > 0}
						{@const recommended = models.openai.filter((m) => isRecommended(m) && matchesSearch(m))}
						{@const others = models.openai.filter((m) => !isRecommended(m) && matchesSearch(m))}
						{@const noResults = recommended.length === 0 && others.length === 0}
						{#if noResults}
							<DropdownMenu.DropdownMenuItem disabled class="text-[11px] text-muted-foreground">
								No models match
							</DropdownMenu.DropdownMenuItem>
						{/if}
						{#if recommended.length > 0}
							<div class="flex items-center gap-1 px-2 pt-1 pb-0.5 text-[10px] text-amber-400/80">
								<ZapIcon class="size-3" />
								Recommended for coding
							</div>
							{#each recommended as m (m)}
								<DropdownMenu.DropdownMenuItem
									class="flex items-center justify-between text-[11px]"
									onclick={() => onchange({ provider: 'openai', model: m })}
								>
									<span class="truncate">{shortModelName(m)}</span>
									{#if value.provider === 'openai' && value.model === m}
										<CheckIcon class="ml-2 size-3 shrink-0 text-amber-400" />
									{:else}
										<ZapIcon class="ml-2 size-3 shrink-0 text-amber-400/40" />
									{/if}
								</DropdownMenu.DropdownMenuItem>
							{/each}
						{/if}
						{#if others.length > 0}
							{#if recommended.length > 0}
								<DropdownMenu.DropdownMenuSeparator />
							{/if}
							{#each others as m (m)}
								<DropdownMenu.DropdownMenuItem
									class="flex items-center justify-between text-[11px]"
									onclick={() => onchange({ provider: 'openai', model: m })}
								>
									<span class="truncate">{shortModelName(m)}</span>
									{#if value.provider === 'openai' && value.model === m}
										<CheckIcon class="ml-2 size-3 shrink-0" />
									{/if}
								</DropdownMenu.DropdownMenuItem>
							{/each}
						{/if}
					{:else}
						<DropdownMenu.DropdownMenuItem disabled class="text-[11px] text-muted-foreground">
							Not configured
						</DropdownMenu.DropdownMenuItem>
					{/if}
				</DropdownMenu.DropdownMenuGroup>
			{/if}
		</DropdownMenu.DropdownMenuContent>
	</DropdownMenu.DropdownMenuPortal>
</DropdownMenu.DropdownMenu>
