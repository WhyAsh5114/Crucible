<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';

	interface Props {
		event: Extract<AgentEvent, { type: 'mesh_help_broadcast' }>;
	}

	let { event }: Props = $props();

	const sig = $derived(event.request.revertSignature);
	const reqId = $derived(event.request.reqId);
	const ttlMs = $derived(event.request.ttlMs);
</script>

<EventFrame label="mesh_help_broadcast" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<span class="font-mono text-[10px] text-muted-foreground">revert</span>
			<code class="rounded bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground">{sig}</code>
		</div>
		<div class="flex items-center gap-2">
			<span class="font-mono text-[10px] text-muted-foreground">reqId</span>
			<code class="font-mono text-[10px] text-muted-foreground/60">{reqId.slice(0, 16)}…</code>
			<span class="ml-auto font-mono text-[10px] text-muted-foreground/40">ttl {ttlMs}ms</span>
		</div>
	</div>
</EventFrame>
