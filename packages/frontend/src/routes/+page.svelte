<script lang="ts">
	import '@fontsource-variable/jetbrains-mono';
	import { ModeWatcher } from 'mode-watcher';
	import Header from '$lib/components/landing/Header.svelte';
	import Hero from '$lib/components/landing/Hero.svelte';
	import Features from '$lib/components/landing/Features.svelte';
	import HowItWorks from '$lib/components/landing/HowItWorks.svelte';
	import TechStack from '$lib/components/landing/TechStack.svelte';
	import Comparison from '$lib/components/landing/Comparison.svelte';
	import Footer from '$lib/components/landing/Footer.svelte';
</script>

<ModeWatcher defaultMode="dark" />

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<Header />
	<main class="flex-1">
		<Hero />
		<Features />
		<HowItWorks />
		<TechStack />
		<Comparison />
	</main>
	<Footer />
</div>

<style>
	:global(.reveal) {
		opacity: 0;
		transform: translateY(16px);
		transition:
			opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1),
			transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.reveal.is-visible) {
		opacity: 1;
		transform: translateY(0);
	}

	:global(html) {
		scroll-behavior: smooth;
	}

	:global(*) {
		transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(a, button) {
		transition-property: color, background-color, border-color, transform, box-shadow;
		transition-duration: 300ms;
	}
</style>
