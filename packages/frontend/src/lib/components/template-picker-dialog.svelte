<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { WorkspaceTemplate } from '@crucible/types';
	import VaultIcon from 'phosphor-svelte/lib/VaultIcon';
	import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';

	export interface TemplateInfo {
		id: WorkspaceTemplate;
		name: string;
		tagline: string;
		description: string;
		tags: string[];
		icon: Component;
	}

	/**
	 * Frontend-side display info for the template picker. Mirrors the
	 * backend's `template-registry.ts` for the public-facing fields. No API
	 * call is needed at picker time — the cards are static metadata that
	 * render instantly on dialog open.
	 */
	export const TEMPLATE_INFO: TemplateInfo[] = [
		{
			id: 'counter',
			name: 'Vault',
			tagline: 'Deposit / withdraw vault with a deliberately broken modifier.',
			description:
				'Watch the agent diagnose, patch, recompile, and redeploy a real bug end-to-end. The signature self-heal demo.',
			tags: ['Solidity', 'Self-heal demo', 'Beginner'],
			icon: VaultIcon
		},
		{
			id: 'uniswap-v3',
			name: 'Uniswap V3 Swap',
			tagline: 'Swap WETH ↔ USDC on a Hardhat fork of mainnet.',
			description:
				'Forwards calls to the V3 SwapRouter. Ask the agent to fork mainnet — any public RPC works — and the same Uniswap contracts you use in production are available locally.',
			tags: ['Uniswap V3', 'Mainnet fork', 'Advanced'],
			icon: ArrowsLeftRightIcon
		},
		{
			id: 'nft-mint',
			name: 'NFT Mint',
			tagline: 'Minimal ERC-721 with a public mint button.',
			description:
				'A hand-rolled ERC-721 with public mint() and a frontend that shows total supply + your holdings. The simplest "press a button → real on-chain transaction → balance updates" demo.',
			tags: ['ERC-721', 'NFT', 'Quick start'],
			icon: DiamondIcon
		}
	];
</script>

<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';

	interface Props {
		open: boolean;
		onCreate: (params: { name: string; template: WorkspaceTemplate }) => Promise<void> | void;
		creating?: boolean;
	}

	let { open = $bindable(false), onCreate, creating = false }: Props = $props();

	let selected = $state<WorkspaceTemplate>('counter');
	let name = $state('');

	async function handleCreate(): Promise<void> {
		if (creating) return;
		await onCreate({
			name: name.trim() || 'Untitled workspace',
			template: selected
		});
	}

	// Reset transient state every time the dialog opens so consecutive
	// create flows don't leak the previous choice.
	$effect(() => {
		if (open) {
			selected = 'counter';
			name = '';
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Create a workspace</Dialog.Title>
			<Dialog.Description>
				Pick a template to scaffold the workspace with. Each template ships with a working contract
				and a live preview UI — the agent can take it from there.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-4">
			<!-- Workspace name -->
			<div class="flex flex-col gap-1.5">
				<Label for="ws-name" class="font-mono text-[10px] tracking-wider uppercase">
					Workspace name <span class="text-muted-foreground/60 normal-case">(optional)</span>
				</Label>
				<Input
					id="ws-name"
					bind:value={name}
					placeholder="Auto-generated if blank"
					class="font-mono text-sm"
					disabled={creating}
				/>
			</div>

			<!-- Template grid -->
			<div class="flex flex-col gap-1.5">
				<span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
					Template
				</span>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{#each TEMPLATE_INFO as info (info.id)}
						{@const Icon = info.icon}
						{@const isSelected = selected === info.id}
						<button
							type="button"
							onclick={() => (selected = info.id)}
							class={cn(
								'group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								isSelected
									? 'border-primary bg-primary/5'
									: 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
							)}
							aria-pressed={isSelected}
						>
							<div class="flex items-start justify-between gap-2">
								<div
									class={cn(
										'flex size-9 shrink-0 items-center justify-center rounded-md transition-colors',
										isSelected
											? 'bg-primary text-primary-foreground'
											: 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
									)}
								>
									<Icon class="size-5" weight="fill" />
								</div>
								{#if isSelected}
									<div
										class="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
									>
										<CheckIcon class="size-3" weight="bold" />
									</div>
								{/if}
							</div>
							<div class="flex flex-col gap-1">
								<h3 class="font-mono text-sm font-medium text-foreground">{info.name}</h3>
								<p class="text-xs leading-relaxed text-muted-foreground">{info.tagline}</p>
							</div>
							<div class="flex flex-wrap gap-1">
								{#each info.tags as tag (tag)}
									<Badge variant="outline" class="font-mono text-[9px]">{tag}</Badge>
								{/each}
							</div>
						</button>
					{/each}
				</div>
			</div>

			<!-- Selected template's longer description -->
			{#each TEMPLATE_INFO as info (info.id)}
				{#if info.id === selected}
					<div
						class="rounded-md border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground"
					>
						{info.description}
					</div>
				{/if}
			{/each}
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="ghost" onclick={() => (open = false)} disabled={creating}>Cancel</Button>
			<Button onclick={handleCreate} disabled={creating}>
				{#if creating}
					<CircleNotchIcon class="size-3.5 animate-spin" weight="bold" data-icon="inline-start" />
					Creating…
				{:else}
					Create workspace
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
