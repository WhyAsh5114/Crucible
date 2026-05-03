<script lang="ts">
	import { toggleMode, mode } from 'mode-watcher';
	import { Sun, Moon } from '@lucide/svelte';
	import GithubLogo from 'phosphor-svelte/lib/GithubLogo';

	const currentMode = $derived(mode.current);
</script>

<header
	class="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md transition-all duration-300"
>
	<div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
		<div class="flex items-center gap-2">
			<img src="/icon.svg" alt="Crucible" class="size-8" />
			<span class="font-semibold text-foreground">Crucible</span>
		</div>

		<div class="flex items-center gap-2">
			<a
				href="https://github.com/WhyAsh5114/Crucible/tree/main/docs"
				target="_blank"
				rel="noopener noreferrer"
				class="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
			>
				Docs
			</a>

			<a
				href="https://github.com/WhyAsh5114/Crucible"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				aria-label="View on GitHub"
			>
				<GithubLogo size={18} />
			</a>

			<button
				onclick={toggleMode}
				class="inline-flex cursor-pointer items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				aria-label="Toggle theme"
			>
				{#if currentMode === 'dark'}
					<Sun size={18} />
				{:else}
					<Moon size={18} />
				{/if}
			</button>
		</div>
	</div>
</header>
