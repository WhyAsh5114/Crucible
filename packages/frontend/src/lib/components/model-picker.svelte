<script lang="ts">
	import { onMount } from 'svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { workspaceClient, type ModelsResponse } from '$lib/api/workspace';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

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
</script>

<DropdownMenu.DropdownMenu>
	<DropdownMenu.DropdownMenuTrigger
		class="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
	>
		{#if value.provider === '0g'}
			<SparklesIcon class="size-3 text-amber-400" />
		{/if}
		<span class="text-muted-foreground">{providerTag}</span>
		<span class="max-w-[96px] truncate text-foreground">{label}</span>
		<ChevronDownIcon class="size-3 text-muted-foreground" />
	</DropdownMenu.DropdownMenuTrigger>

	<DropdownMenu.DropdownMenuPortal>
		<DropdownMenu.DropdownMenuContent
			align="start"
			class="max-h-[60vh] w-64 overflow-y-auto font-mono"
		>
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
						{#each models.openai as m (m)}
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
