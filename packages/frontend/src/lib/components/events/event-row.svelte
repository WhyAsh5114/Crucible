<script lang="ts">
	import type { ChatEvent } from './pair-tool-events';
	import ThinkingRow from './thinking-row.svelte';
	import FileWriteRow from './file-write-row.svelte';
	import RevertDetectedRow from './revert-detected-row.svelte';
	import PatchProposedRow from './patch-proposed-row.svelte';
	import PatchVerifiedRow from './patch-verified-row.svelte';
	import DoneRow from './done-row.svelte';
	import MessageRow from './message-row.svelte';
	import InferenceReceiptRow from './inference-receipt-row.svelte';
	import ErrorRow from './error-row.svelte';
	import GenericRow from './generic-row.svelte';

	interface Props {
		event: ChatEvent;
	}

	let { event }: Props = $props();
</script>

{#if event.type === 'thinking'}
	<ThinkingRow {event} />
{:else if event.type === 'file_write'}
	<FileWriteRow {event} />
{:else if event.type === 'message'}
	<MessageRow {event} />
{:else if event.type === 'revert_detected'}
	<RevertDetectedRow {event} />
{:else if event.type === 'patch_proposed'}
	<PatchProposedRow {event} />
{:else if event.type === 'patch_verified'}
	<PatchVerifiedRow {event} />
{:else if event.type === 'inference_receipt'}
	<InferenceReceiptRow {event} />
{:else if event.type === 'error'}
	<ErrorRow {event} />
{:else if event.type === 'done'}
	<DoneRow {event} />
{:else}
	<GenericRow {event} />
{/if}
