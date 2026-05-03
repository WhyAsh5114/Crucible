<script lang="ts">
	import { Terminal, Zap, Eye, Share2 } from '@lucide/svelte';
	import { reveal } from '$lib/actions/reveal';

	const features = [
		{
			icon: Terminal,
			title: 'Zero-Config Local Chain',
			description: 'Full Hardhat node per workspace. No setup, no ports, no MetaMask.'
		},
		{
			icon: Zap,
			title: 'Self-Healing Reverts',
			description:
				'Agent traces failures, recalls fixes from peer nodes, patches and verifies automatically.'
		},
		{
			icon: Eye,
			title: 'Live dApp Preview',
			description:
				'Real frontend dev server with EIP-1193 wallet bridge injected. Click buttons immediately.'
		},
		{
			icon: Share2,
			title: 'Ship via KeeperHub',
			description:
				'One-click deploy to public chains with simulation, gas estimation, and full audit trail.'
		}
	];
</script>

<section class="border-t border-border py-20">
	<div class="mx-auto max-w-5xl px-4 sm:px-6">
		<h2 class="mb-3 text-center text-2xl font-bold text-foreground sm:text-3xl">
			Built for Speed and Reliability
		</h2>
		<p class="mb-10 text-center text-sm text-muted-foreground sm:text-base">
			Everything you need to go from idea to deployed dApp
		</p>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			{#each features as feature, i (feature.title)}
				<div
					use:reveal={{ delay: i * 100 }}
					class="rounded-lg border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:bg-accent hover:shadow-md"
				>
					<svelte:component
						this={feature.icon}
						size={20}
						class="text-foreground transition-transform duration-300 group-hover:scale-110"
					/>
					<h3 class="mt-3 mb-1.5 text-base font-semibold text-foreground">
						{feature.title}
					</h3>
					<p class="text-sm leading-relaxed text-muted-foreground">
						{feature.description}
					</p>
				</div>
			{/each}
		</div>
	</div>
</section>
