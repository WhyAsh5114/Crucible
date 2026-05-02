<script lang="ts">
	/**
	 * Combined create/rename Dialog for chat sessions.
	 *
	 * Same component handles both flows because they're nearly identical
	 * (text input + confirm) — a `mode` prop discriminates the title /
	 * button copy and whether the input is pre-filled. Callbacks return
	 * promises so the dialog can spin a loader while the network call
	 * settles, then auto-close on success.
	 */
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';

	export type ChatSessionDialogMode = 'create' | 'rename';

	interface Props {
		open: boolean;
		mode: ChatSessionDialogMode;
		/** For `rename`: the current title to pre-fill. Ignored on `create`. */
		initialName?: string;
		/** Called with the trimmed name when the user submits. */
		onSubmit: (name: string) => Promise<void> | void;
	}

	let { open = $bindable(false), mode, initialName = '', onSubmit }: Props = $props();

	let name = $state('');
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			name = initialName;
			submitting = false;
		}
	});

	const title = $derived(mode === 'create' ? 'New chat session' : 'Rename chat session');
	const description = $derived(
		mode === 'create'
			? 'Pick a name for the new chat. Leave blank for an auto-generated one.'
			: 'Update the chat session title.'
	);
	const confirmLabel = $derived(mode === 'create' ? 'Create' : 'Save');

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting) return;
		submitting = true;
		try {
			await onSubmit(name.trim());
			open = false;
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="chat-session-name" class="font-mono text-[10px] tracking-wider uppercase">
					Name
				</Label>
				<Input
					id="chat-session-name"
					bind:value={name}
					placeholder={mode === 'create' ? 'e.g. "Refactor DemoVault"' : 'Chat name'}
					autocomplete="off"
					disabled={submitting}
				/>
			</div>

			<Dialog.Footer class="gap-2">
				<Button type="button" variant="ghost" onclick={() => (open = false)} disabled={submitting}>
					Cancel
				</Button>
				<Button type="submit" disabled={submitting}>
					{#if submitting}
						<CircleNotchIcon class="size-3.5 animate-spin" weight="bold" data-icon="inline-start" />
						{confirmLabel}…
					{:else}
						{confirmLabel}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
