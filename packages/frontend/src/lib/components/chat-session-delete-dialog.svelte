<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';

	interface Props {
		open: boolean;
		/** Title of the chat session being deleted, shown in the prompt. */
		sessionTitle: string;
		onConfirm: () => Promise<void> | void;
	}

	let { open = $bindable(false), sessionTitle, onConfirm }: Props = $props();

	let deleting = $state(false);

	$effect(() => {
		if (open) deleting = false;
	});

	async function handleDelete(): Promise<void> {
		if (deleting) return;
		deleting = true;
		try {
			await onConfirm();
			open = false;
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<WarningIcon class="size-5 text-destructive" weight="fill" />
				Delete chat session
			</Dialog.Title>
			<Dialog.Description>
				Delete <span class="font-mono text-foreground">"{sessionTitle}"</span>? Its full chat
				history will be permanently removed from the workspace. This can't be undone.
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer class="gap-2">
			<Button variant="ghost" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={deleting}>
				{#if deleting}
					<CircleNotchIcon class="size-3.5 animate-spin" weight="bold" data-icon="inline-start" />
					Deleting…
				{:else}
					Delete
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
