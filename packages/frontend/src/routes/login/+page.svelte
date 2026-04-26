<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';

	let mode = $state<'signin' | 'signup'>('signin');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function submit(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		submitting = true;
		error = null;

		const endpoint =
			mode === 'signin'
				? '/api/auth/sign-in/email'
				: '/api/auth/sign-up/email';

		const body: Record<string, string> = { email, password };
		if (mode === 'signup') body['name'] = name;

		const res = await fetch(endpoint, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch((err: unknown) => {
			error = err instanceof Error ? err.message : 'Network error';
			return null;
		});

		submitting = false;

		if (!res) return;

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			error = (body as { message?: string }).message ?? `HTTP ${res.status}`;
			return;
		}

		goto(resolve('/'));
	}

	function toggleMode(): void {
		mode = mode === 'signin' ? 'signup' : 'signin';
		error = null;
	}

	async function signInAnonymously(): Promise<void> {
		submitting = true;
		error = null;
		const result = await authClient.signIn.anonymous();
		submitting = false;
		if (result.error) {
			error = result.error.message ?? 'Anonymous sign-in failed';
			return;
		}
		goto(resolve('/'));
	}
</script>

<div class="flex h-full w-full items-center justify-center bg-background p-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<h1 class="font-mono text-2xl font-semibold tracking-tight text-foreground">Crucible</h1>
			<p class="mt-1 font-mono text-sm text-muted-foreground">
				{mode === 'signin' ? 'Sign in to continue' : 'Create an account'}
			</p>
		</div>

		<form
			onsubmit={submit}
			class="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-6"
		>
			{#if mode === 'signup'}
				<div class="flex flex-col gap-1.5">
					<label for="name" class="font-mono text-xs text-muted-foreground">Name</label>
					<input
						id="name"
						type="text"
						autocomplete="name"
						required
						bind:value={name}
						class="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
						placeholder="Ada Lovelace"
					/>
				</div>
			{/if}

			<div class="flex flex-col gap-1.5">
				<label for="email" class="font-mono text-xs text-muted-foreground">Email</label>
				<input
					id="email"
					type="email"
					autocomplete="email"
					required
					bind:value={email}
					class="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
					placeholder="you@example.com"
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="password" class="font-mono text-xs text-muted-foreground">Password</label>
				<input
					id="password"
					type="password"
					autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
					required
					minlength={8}
					bind:value={password}
					class="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
					placeholder="••••••••"
				/>
			</div>

			{#if error}
				<p class="font-mono text-xs text-destructive">{error}</p>
			{/if}

			<button
				type="button"
				disabled={submitting}
				onclick={signInAnonymously}
				class="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-muted-foreground transition-colors disabled:opacity-50 hover:bg-muted hover:text-foreground"
			>
				Continue anonymously
			</button>

			<div class="flex items-center gap-3">
				<hr class="flex-1 border-border" />
				<span class="font-mono text-xs text-muted-foreground">or</span>
				<hr class="flex-1 border-border" />
			</div>

			<button
				type="submit"
				disabled={submitting}
				class="rounded-md bg-foreground px-3 py-2 font-mono text-sm font-medium text-background transition-opacity disabled:opacity-50 hover:opacity-80"
			>
				{#if submitting}
					{mode === 'signin' ? 'Signing in…' : 'Creating account…'}
				{:else}
					{mode === 'signin' ? 'Sign in' : 'Create account'}
				{/if}
			</button>
		</form>

		<p class="mt-4 text-center font-mono text-xs text-muted-foreground">
			{mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
			<button
				type="button"
				onclick={toggleMode}
				class="ml-1 text-foreground underline underline-offset-2 hover:no-underline"
			>
				{mode === 'signin' ? 'Sign up' : 'Sign in'}
			</button>
		</p>
	</div>
</div>
