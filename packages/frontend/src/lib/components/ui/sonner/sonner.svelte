<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
	import { mode } from 'mode-watcher';
	import SpinnerIcon from 'phosphor-svelte/lib/Spinner';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
	import XCircleIcon from 'phosphor-svelte/lib/XCircle';
	import InfoIcon from 'phosphor-svelte/lib/Info';
	import WarningIcon from 'phosphor-svelte/lib/Warning';

	let { ...restProps }: SonnerProps = $props();
</script>

<!--
  Toaster styling notes:
  - `--normal-bg` etc. theme the toast container itself.
  - Action / cancel button vars (`--accent-button-*`) hook into sonner's
    classNames API so the in-toast buttons match the rest of the UI's
    primary/secondary palette instead of falling back to white-on-default.
  - `actionButtonStyle` / `cancelButtonStyle` apply the same vars inline so
    sonner's internal styles can't override them.
-->
<Sonner
	theme="dark"
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	toastOptions={{
		actionButtonStyle:
			'background: var(--color-primary); color: var(--color-primary-foreground); border: none; border-radius: calc(var(--radius) - 2px); padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 500; cursor: pointer;',
		cancelButtonStyle:
			'background: var(--color-secondary); color: var(--color-secondary-foreground); border: 1px solid var(--color-border); border-radius: calc(var(--radius) - 2px); padding: 0.25rem 0.6rem; font-size: 0.75rem; cursor: pointer;'
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<SpinnerIcon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CheckCircleIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<XCircleIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<WarningIcon class="size-4" />
	{/snippet}
</Sonner>
