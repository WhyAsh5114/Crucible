<script lang="ts">
	import type { ChatEvent } from './pair-tool-events';
	import ThinkingRow from './thinking-row.svelte';
	import UserPromptRow from './user-prompt-row.svelte';
	import FileWriteRow from './file-write-row.svelte';
	import RevertDetectedRow from './revert-detected-row.svelte';
	import PatchProposedRow from './patch-proposed-row.svelte';
	import PatchVerifiedRow from './patch-verified-row.svelte';
	import RepairFailedRow from './repair-failed-row.svelte';
	import DoneRow from './done-row.svelte';
	import MessageRow from './message-row.svelte';
	import InferenceReceiptRow from './inference-receipt-row.svelte';
	import ErrorRow from './error-row.svelte';
	import GenericRow from './generic-row.svelte';
	import ShipSimulatedRow from './ship-simulated-row.svelte';
	import ShipStatusRow from './ship-status-row.svelte';
	import ShipConfirmedRow from './ship-confirmed-row.svelte';
	import MeshHelpBroadcastRow from './mesh-help-broadcast-row.svelte';
	import MeshHelpReceivedRow from './mesh-help-received-row.svelte';

	interface Props {
		event: ChatEvent;
		repeatCount?: number;
	}

	let { event, repeatCount = 1 }: Props = $props();
</script>

{#if event.type === 'user_prompt'}
	<UserPromptRow {event} />
{:else if event.type === 'thinking'}
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
{:else if event.type === 'repair_failed'}
	<RepairFailedRow {event} />
{:else if event.type === 'inference_receipt'}
	<InferenceReceiptRow {event} />
{:else if event.type === 'ship_simulated'}
	<ShipSimulatedRow {event} />
{:else if event.type === 'ship_status'}
	<ShipStatusRow {event} />
{:else if event.type === 'ship_confirmed'}
	<ShipConfirmedRow {event} />
{:else if event.type === 'mesh_help_broadcast'}
	<MeshHelpBroadcastRow {event} />
{:else if event.type === 'mesh_help_received'}
	<MeshHelpReceivedRow {event} />
{:else if event.type === 'error'}
	<ErrorRow {event} />
{:else if event.type === 'done'}
	<DoneRow {event} />
{:else}
	<GenericRow {event} {repeatCount} />
{/if}
