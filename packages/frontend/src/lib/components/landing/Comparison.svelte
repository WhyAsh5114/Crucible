<script lang="ts">
	import { Check, X } from '@lucide/svelte';
	import { reveal } from '$lib/actions/reveal';

	const tools = [
		{
			name: 'Remix',
			icon: 'https://remix.ethereum.org/assets/img/remix-logo-blue.png'
		},
		{
			name: 'ChainIDE',
			icon: 'https://chainide.com/favicon.ico'
		},
		{
			name: 'v0',
			displayName: 'v0 (Vercel)',
			icon: 'https://v0.dev/favicon.ico'
		},
		{
			name: 'Crucible',
			icon: '/icon.svg',
			isLocal: true
		}
	];

	const rows = [
		{
			feature: 'AI-Driven',
			values: [
				{ text: 'RemixAI (chat)', positive: true },
				{ text: 'Code Sage AI', positive: true },
				{ text: 'Frontend + backend (sandbox)', positive: true },
				{ text: 'Full-stack + chain', positive: true }
			]
		},
		{
			feature: 'Local Chain',
			values: [
				{ text: 'JS VM (in-browser, limited)', positive: true },
				{ text: 'Cloud sandbox only', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Full Hardhat node (server-side)', positive: true }
			]
		},
		{
			feature: 'Embedded Wallet',
			values: [
				{ text: '10 test accounts', positive: true },
				{ text: 'No (requires external MetaMask)', negative: true },
				{ text: 'N/A', negative: true },
				{ text: 'Pre-funded, labeled, auto-synced', positive: true }
			]
		},
		{
			feature: 'Live dApp Preview',
			values: [
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Yes', positive: true },
				{ text: 'Yes, with chain injection', positive: true }
			]
		},
		{
			feature: 'Tx Inspector',
			values: [
				{ text: 'Basic only', negative: true },
				{ text: 'Basic only', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Decoded traces, events, KeeperHub audit trail', positive: true }
			]
		},
		{
			feature: 'Agent has chain context',
			values: [
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Yes, via MCP', positive: true }
			]
		},
		{
			feature: 'Persistent agent memory',
			values: [
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Yes, on 0G Storage (cross-session, cross-node)', positive: true }
			]
		},
		{
			feature: 'Peer knowledge mesh',
			values: [
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Yes, via Gensyn AXL', positive: true }
			]
		},
		{
			feature: 'Self-Healing Reverts',
			values: [
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'No', negative: true },
				{ text: 'Recall → mesh → patch → verify → remember', positive: true }
			]
		},
		{
			feature: 'Ship to public chains',
			values: [
				{ text: 'Manual', negative: true },
				{ text: 'Manual', negative: true },
				{ text: 'N/A', negative: true },
				{ text: 'One-click via KeeperHub (with audit trail)', positive: true }
			]
		}
	];
</script>

<section class="border-t border-border py-20">
	<div class="mx-auto max-w-5xl px-4 sm:px-6">
		<h2 class="mb-3 text-center text-2xl font-bold text-foreground sm:text-3xl">
			How Crucible Compares
		</h2>
		<p class="mb-12 text-center text-sm text-muted-foreground sm:text-base">
			A complete picture of what each tool actually gives you
		</p>

		<div
			use:reveal
			class="overflow-x-auto rounded-lg border border-border transition-all duration-300 hover:shadow-md"
		>
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-border">
						<th class="w-40 bg-muted px-4 py-3 text-left font-mono text-xs text-muted-foreground">
							<!-- Feature column header -->
						</th>
						{#each tools as tool, i (tool.name)}
							<th
								class="px-4 py-3 text-center text-xs font-semibold {i === 3
									? 'border-x border-border bg-primary text-primary-foreground'
									: 'bg-muted text-foreground'}"
							>
								<div class="flex items-center justify-center gap-2">
									<img
										src={tool.icon}
										alt={tool.name}
										class="h-4 w-4 object-contain"
										loading="lazy"
									/>
									<span>{tool.displayName || tool.name}</span>
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row, rowIndex (row.feature)}
						<tr
							class="border-b border-border transition-colors duration-200 last:border-0 hover:bg-muted/30 {rowIndex %
								2 ===
							0
								? 'bg-card'
								: 'bg-background'}"
						>
							<td class="px-4 py-3 text-xs font-medium whitespace-nowrap text-foreground">
								{row.feature}
							</td>
							{#each row.values as value, colIndex (`${row.feature}-${colIndex}`)}
								<td
									class="px-4 py-3 text-center text-xs {colIndex === 3
										? 'border-x border-border font-medium text-foreground'
										: 'text-muted-foreground'}"
								>
									<span class="inline-flex items-center justify-center gap-1.5">
										{#if value.negative}
											<X size={14} class="shrink-0 text-muted-foreground" />
										{:else if value.positive}
											<Check size={14} class="shrink-0 {colIndex === 3 ? 'text-foreground' : 'text-muted-foreground'}" />
										{/if}
										{value.text}
									</span>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="mt-3 text-center text-xs text-muted-foreground sm:hidden">← Scroll to compare →</p>
	</div>
</section>
