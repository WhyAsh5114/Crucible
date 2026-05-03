<script lang="ts">
	import type { WorkspaceState } from '@crucible/types';
	import * as Card from '$lib/components/ui/card';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	interface Props {
		workspace: WorkspaceState | null;
		loading: boolean;
		loadError: string | null;
	}

	let { workspace, loading, loadError }: Props = $props();

	type StepStatus = 'done' | 'active' | 'pending' | 'failed' | 'skipped';

	interface Step {
		id: 'container' | 'chain' | 'template' | 'preview';
		label: string;
		status: StepStatus;
	}

	const previewFailed = $derived(workspace?.previewState.phase === 'failed');
	const templateFailed = $derived(workspace?.templateState.phase === 'failed');

	const containerStatus: StepStatus = $derived(workspace !== null ? 'done' : 'active');

	const chainStatus: StepStatus = $derived.by(() => {
		if (!workspace) return 'pending';
		if (workspace.chainState !== null) return 'done';
		return 'active';
	});

	const templateStatus: StepStatus = $derived.by(() => {
		if (!workspace) return 'pending';
		const phase = workspace.templateState.phase;
		if (phase === 'ready') return 'done';
		if (phase === 'failed') return 'failed';
		// `unavailable` = workspace has no DemoVault.sol (agent removed it).
		// Treat as a skipped step so the overlay doesn't block on it.
		if (phase === 'unavailable') return 'skipped';
		// `idle` when chain is already booted means the in-memory deploy state was
		// reset (e.g. backend restart). The deploy won't re-run automatically, so
		// treat it as skipped to avoid the overlay spinning forever.
		if (phase === 'idle') return workspace.chainState === null ? 'pending' : 'skipped';
		if (workspace.chainState === null) return 'pending';
		return 'active';
	});

	const previewStatus: StepStatus = $derived.by(() => {
		if (!workspace) return 'pending';
		if (previewFailed) return 'failed';
		if (workspace.previewState.phase === 'ready') return 'done';
		if (workspace.chainState === null) return 'pending';
		return 'active';
	});

	const steps: Step[] = $derived([
		{ id: 'container', label: 'Container ready', status: containerStatus },
		{ id: 'chain', label: 'Chain booted', status: chainStatus },
		{ id: 'template', label: 'Contract deployed', status: templateStatus },
		{ id: 'preview', label: 'Preview ready', status: previewStatus }
	]);

	const title = $derived.by(() => {
		if (loadError) return 'Workspace failed to load';
		if (previewFailed) return 'Preview crashed';
		if (templateFailed) return 'Contract deploy failed';
		return 'Initializing workspace';
	});

	const description = $derived.by(() => {
		if (loadError) return loadError;
		if (previewFailed) {
			return 'The preview dev server failed to start. Check the log output below for details.';
		}
		if (templateFailed) {
			return (
				workspace?.templateState.message ??
				'The contract failed to compile or deploy. The agent can recover via tools.'
			);
		}
		if (!workspace) {
			return loading
				? 'Reaching the workspace runtime — this should only take a moment.'
				: 'Waiting for the workspace runtime to come online.';
		}
		if (workspace.chainState === null) {
			return 'Booting the per-workspace Hardhat node and connecting MCP services.';
		}
		// Surface the template phase before falling through to the preview phase
		// so the user sees what's actually blocking boot.
		const tphase = workspace.templateState.phase;
		if (tphase === 'compiling') return 'Compiling the contract with Hardhat.';
		if (tphase === 'deploying') return 'Deploying the contract to the local chain.';
		const phase = workspace.previewState.phase;
		if (phase === 'installing') {
			return 'Installing dependencies — first-time `bun install` can take 30–60 seconds.';
		}
		if (phase === 'starting') {
			return 'Starting the Vite dev server — almost there.';
		}
		if (phase === 'idle') {
			return 'Preparing the preview supervisor.';
		}
		return 'Finalizing workspace.';
	});

	const logLines = $derived(workspace?.previewState.logTail ?? []);
	const hasLogs = $derived(logLines.length > 0);

	// Attachment that auto-scrolls the log block to the bottom whenever
	// `logLines` changes. The outer attachment runs once when the log block
	// mounts; the nested `$effect` re-runs on each `logLines` update.
	function autoScrollToBottom(node: HTMLDivElement) {
		$effect(() => {
			// Touch logLines so the effect tracks it.
			void logLines;
			node.scrollTop = node.scrollHeight;
		});
	}
</script>

<div
	class="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-6 backdrop-blur-md"
>
	<Card.Root class="w-full max-w-md shadow-xl">
		<Card.Header>
			<div class="flex items-center gap-2 pb-1">
				<span
					class="size-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]"
					aria-hidden="true"
				></span>
				<span class="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
					Crucible
				</span>
			</div>
			<Card.Title class="flex items-center gap-2">
				{#if loadError || previewFailed}
					<AlertTriangleIcon class="size-5 text-destructive" />
				{:else}
					<LoaderIcon class="size-5 animate-spin text-primary" />
				{/if}
				{title}
			</Card.Title>
			<Card.Description>{description}</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			{#if !loadError}
				<ul class="flex flex-col gap-2">
					{#each steps as step (step.id)}
						<li class="flex items-center gap-2 text-sm">
							{#if step.status === 'done'}
								<CheckCircleIcon class="size-4 text-live" />
								<span class="text-foreground">{step.label}</span>
							{:else if step.status === 'active'}
								<LoaderIcon class="size-4 animate-spin text-primary" />
								<span class="font-medium text-foreground">{step.label}</span>
							{:else if step.status === 'failed'}
								<AlertTriangleIcon class="size-4 text-destructive" />
								<span class="text-destructive">{step.label}</span>
							{:else if step.status === 'skipped'}
								<CircleIcon class="size-4 text-muted-foreground/50" />
								<span class="text-muted-foreground/70 line-through">{step.label}</span>
							{:else}
								<CircleIcon class="size-4 text-muted-foreground" />
								<span class="text-muted-foreground">{step.label}</span>
							{/if}
						</li>
					{/each}
				</ul>

				{#if hasLogs}
					<div
						{@attach autoScrollToBottom}
						class="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
					>
						{#each logLines as line, index (index)}
							<div class="whitespace-pre-wrap">{line}</div>
						{/each}
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>
