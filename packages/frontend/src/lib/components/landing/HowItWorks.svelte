<script lang="ts">
	import { reveal } from '$lib/actions/reveal';

	const steps = [
		{
			number: '01',
			title: 'Open a Workspace',
			description:
				'The backend creates a real project directory, boots a Hardhat chain, and opens a terminal session.'
		},
		{
			number: '02',
			title: 'Prompt the Agent',
			description:
				'Describe what you want in natural language. The agent begins writing real files with visible tool activity.'
		},
		{
			number: '03',
			title: 'Watch Code Appear',
			description:
				'Files update in CodeMirror. Compilation and deployment run against real disk files. Preview starts automatically.'
		},
		{
			number: '04',
			title: 'Ship to a Real Chain',
			description:
				'Click Ship. KeeperHub handles simulation, gas, execution, retries, and the audit trail.'
		}
	];
</script>

<section class="border-t border-border py-20">
	<div class="mx-auto max-w-5xl px-4 sm:px-6">
		<h2 class="mb-3 text-center text-2xl font-bold text-foreground sm:text-3xl">How It Works</h2>
		<p class="mb-12 text-center text-sm text-muted-foreground sm:text-base">
			From prompt to production in four steps
		</p>

		<div class="space-y-8">
			{#each steps as step, i}
				<div
					use:reveal={{ delay: i * 100 }}
					class="group flex gap-6 transition-all duration-300 hover:translate-x-2"
				>
					<div class="flex-shrink-0">
						<span
							class="font-mono text-3xl font-bold text-muted-foreground transition-colors duration-300 group-hover:text-primary"
						>
							{step.number}
						</span>
					</div>
					<div
						class="flex-1 border-l border-border pl-6 transition-colors duration-300 group-hover:border-primary/40"
					>
						<h3
							class="mb-2 text-base font-semibold text-foreground transition-colors duration-300 group-hover:text-primary"
						>
							{step.title}
						</h3>
						<p class="text-sm text-muted-foreground">
							{step.description}
						</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>
