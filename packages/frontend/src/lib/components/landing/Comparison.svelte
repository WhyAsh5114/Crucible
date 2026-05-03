<script lang="ts">
	import { Check, X } from '@lucide/svelte';
	import { reveal } from '$lib/actions/reveal';

	const tools = ['Remix', 'ChainIDE', 'v0 (Vercel)', 'Crucible'];

	const rows = [
		{
			feature: 'AI-Driven',
			values: ['No', 'No', 'Frontend only', 'Full-stack + chain']
		},
		{
			feature: 'Local Chain',
			values: ['JS VM (limited)', 'Partial', 'No', 'Full Hardhat node (server-side)']
		},
		{
			feature: 'Embedded Wallet',
			values: ['Yes (basic)', 'No', 'N/A', 'Pre-funded, labeled, auto-synced']
		},
		{
			feature: 'Live dApp Preview',
			values: ['No', 'No', 'Yes', 'Yes, with chain injection']
		},
		{
			feature: 'Agent has chain context',
			values: ['No', 'No', 'No', 'Yes, via MCP']
		},
		{
			feature: 'Persistent agent memory',
			values: ['No', 'No', 'No', 'Yes, on 0G Storage']
		},
		{
			feature: 'Peer knowledge mesh',
			values: ['No', 'No', 'No', 'Yes, via Gensyn AXL']
		},
		{
			feature: 'Self-Healing Reverts',
			values: ['No', 'No', 'No', 'Recall → mesh → patch → verify']
		},
		{
			feature: 'Ship to public chains',
			values: ['Manual', 'Manual', 'N/A', 'One-click via KeeperHub']
		}
	];

	function isNegative(value: string): boolean {
		return value === 'No' || value === 'Manual' || value === 'N/A' || value === 'Partial';
	}

	function isPositive(value: string): boolean {
		return value.startsWith('Yes') || (!isNegative(value) && value.length > 3);
	}
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
						{#each tools as tool, i (tool)}
							<th
								class="px-4 py-3 text-center text-xs font-semibold {i === 3
									? 'border-x border-border bg-primary text-primary-foreground'
									: 'bg-muted text-foreground'}"
							>
								{tool}
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
										{#if isNegative(value)}
											<X size={12} class="text-muted-foreground" />
										{:else if isPositive(value)}
											<Check size={12} class={colIndex === 3 ? 'text-foreground' : ''} />
										{/if}
										{value}
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
