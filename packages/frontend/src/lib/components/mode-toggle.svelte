<script lang="ts">
	import { toggleMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';

	interface Props {
		variant?: 'ghost' | 'outline' | 'secondary';
		class?: string;
	}

	let { variant = 'ghost', class: className }: Props = $props();
</script>

<Button {variant} size="icon" onclick={toggleMode} aria-label="Toggle theme" class={className}>
	<SunIcon weight="bold" class="hidden dark:block" />
	<MoonIcon weight="bold" class="dark:hidden" />
	<span class="sr-only">Toggle theme</span>
</Button>
