<script lang="ts">
	import { reveal } from '$lib/actions/reveal';

	const technologies = [
		{
			name: 'SvelteKit',
			icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/svelte/svelte-original.svg'
		},
		{
			name: 'TypeScript',
			icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg'
		},
		{
			name: 'Hardhat',
			icon: 'https://seeklogo.com/images/H/hardhat-logo-888739EBB4-seeklogo.com.png'
		},
		{
			name: 'Viem',
			icon: 'https://viem.sh/icon-light.png'
		},
		{
			name: 'CodeMirror',
			icon: 'https://codemirror.net/logo.svg'
		},
		{
			name: 'Hono',
			icon: 'https://raw.githubusercontent.com/honojs/hono/main/docs/images/hono-title.png'
		},
		{
			name: 'Bun',
			icon: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/bun/bun-original.svg'
		},
		{
			name: 'Turborepo',
			icon: 'https://turbo.build/images/docs/repo/repo-hero-logo-dark.svg'
		}
	];
</script>

<section class="border-t border-border py-20">
	<div class="mx-auto max-w-5xl px-4 sm:px-6">
		<h2 class="mb-8 text-center text-xl font-semibold text-foreground">Built With</h2>

		<div use:reveal class="flex flex-wrap items-center justify-center gap-4">
			{#each technologies as tech, i}
				<div
					class="group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-all duration-300 hover:border-primary/40 hover:bg-muted/50"
					style="animation-delay: {i * 50}ms;"
				>
					<img
						src={tech.icon}
						alt={tech.name}
						class="h-5 w-5 object-contain transition-transform duration-300 group-hover:scale-110"
						loading="lazy"
					/>
					<span
						class="font-mono text-xs text-muted-foreground transition-colors duration-300 group-hover:text-foreground"
					>
						{tech.name}
					</span>
				</div>
			{/each}
		</div>
	</div>
</section>
