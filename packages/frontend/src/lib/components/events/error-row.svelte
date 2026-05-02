<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import { getContext } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'error' }>;
	}

	let { event }: Props = $props();

	/**
	 * Optional context callback wired by `chat-rail.svelte` so the user can
	 * retry the last prompt against the OpenAI-compatible fallback when the
	 * 0G Compute Router fails. Absent in test/mount contexts.
	 */
	const retry = getContext<(() => void) | undefined>('retryWithFallback');

	function fallbackLabel(reason: string): string {
		switch (reason) {
			case 'rate_limited':
				return 'Rate limited';
			case 'balance_exhausted':
				return 'Balance exhausted';
			case 'provider_unavailable':
				return 'Provider unavailable';
			case 'admin_override':
				return 'Admin override';
			default:
				return reason;
		}
	}
</script>

<EventFrame label="error" tone="destructive" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-2">
		<p class="text-destructive">{event.message}</p>
		{#if event.ogFallbackReason}
			<div class="flex flex-wrap items-center gap-2 text-xs">
				<span
					class="rounded bg-warning/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-warning uppercase"
				>
					0G failed: {fallbackLabel(event.ogFallbackReason)}
				</span>
				{#if retry}
					<Button type="button" size="sm" variant="outline" onclick={retry}>
						Retry with OpenAI
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</EventFrame>
