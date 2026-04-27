<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import GoogleLogoIcon from 'phosphor-svelte/lib/GoogleLogoIcon';
	import WalletIcon from 'phosphor-svelte/lib/WalletIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import { authClient } from '$lib/auth-client';
	import { signInWithEthereum, SiweError } from '$lib/siwe';

	type Props = {
		/** URL the OAuth flow redirects back to on success. */
		callbackURL?: string;
	};
	let { callbackURL = '/workspaces' }: Props = $props();

	let pending = $state<'siwe' | 'google' | null>(null);
	let error = $state<string | null>(null);

	async function onGoogle(): Promise<void> {
		pending = 'google';
		error = null;
		const res = await authClient.signIn.social({ provider: 'google', callbackURL });
		if (res.error) {
			error = res.error.message ?? 'Google sign-in failed.';
			pending = null;
		}
		// On success the browser navigates to Google's consent screen, so no
		// reset needed in the success path.
	}

	async function onSiwe(): Promise<void> {
		pending = 'siwe';
		error = null;
		try {
			await signInWithEthereum();
			// Reload so the layout's session store re-reads the new cookie and
			// the start screen flips into the dashboard view.
			window.location.assign(callbackURL);
		} catch (err) {
			error = err instanceof SiweError ? err.message : 'Wallet sign-in failed.';
			pending = null;
		}
	}
</script>

<Card.Root class="mx-auto w-full max-w-sm">
	<Card.Header>
		<Card.Title>Welcome to Crucible</Card.Title>
		<Card.Description>Sign in to spin up an isolated Web3 workspace.</Card.Description>
	</Card.Header>
	<Card.Content>
		<Field.FieldGroup>
			{#if error}
				<Alert.Root>
					<WarningIcon class="text-muted-foreground" />
					<Alert.Title>Sign-in failed</Alert.Title>
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}

			<Field.Field>
				<Button variant="outline" disabled={pending !== null} onclick={onGoogle}>
					<GoogleLogoIcon data-icon="inline-start" weight="bold" />
					{pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
				</Button>
			</Field.Field>

			<div class="flex items-center gap-3">
				<Separator class="flex-1" />
				<span class="font-mono text-xs text-muted-foreground">or</span>
				<Separator class="flex-1" />
			</div>

			<Field.Field>
				<Button disabled={pending !== null} onclick={onSiwe}>
					<WalletIcon data-icon="inline-start" weight="bold" />
					{pending === 'siwe' ? 'Awaiting signature…' : 'Sign in with Ethereum'}
				</Button>
				<Field.FieldDescription>
					Requires an EIP-1193 wallet (MetaMask, Rabby, etc.) installed in this browser.
				</Field.FieldDescription>
			</Field.Field>
		</Field.FieldGroup>
	</Card.Content>
</Card.Root>
