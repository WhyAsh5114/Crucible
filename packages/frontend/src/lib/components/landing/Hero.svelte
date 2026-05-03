<script lang="ts">
	import { Zap, ChevronRight } from '@lucide/svelte';
	import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
	import { Button } from '$lib/components/ui/button';
	import { scrollZoom } from '$lib/actions/parallax';
</script>

<section
	class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-4 sm:px-6 sm:py-20"
>
	<div class="sticky top-0 flex min-h-screen w-full items-center justify-center">
		<div class="mx-auto flex max-w-5xl flex-col items-center text-center">
			<div
				data-zoom-fade
				class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 font-mono text-xs text-muted-foreground transition-all duration-300 hover:border-primary/40 hover:bg-primary/10"
				style="animation: fade-in 0.6s ease both; animation-delay: 0.1s;"
			>
				<Zap size={12} class="transition-transform duration-300 hover:rotate-12" />
				AI-Powered Browser IDE for Web3
			</div>

			<h1
				data-zoom-fade
				class="mt-6 text-4xl leading-tight font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl"
				style="animation: slide-up 0.6s ease both; animation-delay: 0.2s;"
			>
				Describe a dApp.<br />Watch it build itself.<br />Ship it.
			</h1>

			<p
				data-zoom-fade
				class="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg"
				style="animation: fade-in 0.6s ease both; animation-delay: 0.35s;"
			>
				An AI agent that writes, compiles, deploys, and previews decentralized applications — all in
				one browser tab, with full transparency into every step.
			</p>

			<div
				data-zoom-fade
				class="mt-8 flex flex-row items-center justify-center gap-3"
				style="animation: fade-in 0.6s ease both; animation-delay: 0.5s;"
			>
				<Button
					href="/workspaces"
					class="inline-flex items-center gap-1.5 transition-all duration-300 hover:scale-105 hover:shadow-lg"
				>
					Get Started
					<ChevronRight
						size={16}
						class="transition-transform duration-300 group-hover:translate-x-1"
					/>
				</Button>

				<Button
					variant="outline"
					href="https://github.com/WhyAsh5114/Crucible"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1.5 transition-all duration-300 hover:scale-105 hover:shadow-md"
				>
					<GithubLogo size={16} class="transition-transform duration-300 group-hover:rotate-12" />
					View on GitHub
				</Button>
			</div>

			<div
				use:scrollZoom
				class="mt-12 w-full max-w-4xl origin-center"
				style="will-change: transform;"
			>
				<img
					src="/cover_image.png"
					alt="Crucible IDE — AI-powered dApp development workspace"
					class="w-full rounded-lg border border-border shadow-lg"
					loading="eager"
				/>
			</div>
		</div>
	</div>
</section>

<style>
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slide-up {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0px);
		}
		50% {
			transform: translateY(-8px);
		}
	}
</style>
