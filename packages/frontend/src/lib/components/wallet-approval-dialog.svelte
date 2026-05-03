<script lang="ts">
	/**
	 * Modal approval dialog for the Crucible dev wallet.
	 *
	 * Mounted once at the IDE layout level so any pending wallet request
	 * (eth_sendTransaction / personal_sign / eth_signTypedData_v4) intercepted
	 * by the EIP-1193 bridge surfaces as a centered Dialog regardless of which
	 * tab the user has open. The user reviews the decoded payload, hits
	 * Approve or Reject, and is dropped back exactly where they were.
	 *
	 * Multiple pending requests queue: the dialog always renders the FIRST
	 * unresolved entry; once approved/rejected, the next one slides in. The
	 * dialog auto-closes when the queue empties.
	 */
	import { formatEther, hexToString, isHex } from 'viem';
	import { getWalletStore, type PendingRequest } from '$lib/state/wallet.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';

	const wallet = getWalletStore();

	// Always show the head of the queue so the user resolves them in arrival
	// order. `bind:open` is driven by the queue length: the dialog opens the
	// moment a request lands and closes when the queue empties.
	const current = $derived<PendingRequest | null>(wallet.pending[0] ?? null);
	const open = $derived(current !== null);

	function setOpen(next: boolean): void {
		// User dismissed the dialog (Esc, scrim click) — treat as a rejection
		// of the current request so the dApp's promise resolves rather than
		// hanging forever. EIP-1193 standard error code is 4001.
		if (!next && current) {
			wallet.reject(current.id);
		}
	}

	// ── Decoders ─────────────────────────────────────────────────────────────

	interface DecodedTx {
		from?: string;
		to?: string;
		value?: string;
		data?: string;
		gas?: string;
	}

	function decodeTx(req: PendingRequest): DecodedTx {
		const raw = req.params[0] as Record<string, unknown> | undefined;
		if (!raw || typeof raw !== 'object') return {};
		const out: DecodedTx = {};
		if (typeof raw.from === 'string') out.from = raw.from;
		if (typeof raw.to === 'string') out.to = raw.to;
		if (typeof raw.value === 'string') {
			try {
				out.value = `${formatEther(BigInt(raw.value))} ETH`;
			} catch {
				out.value = raw.value;
			}
		}
		if (typeof raw.data === 'string' && raw.data !== '0x') out.data = raw.data;
		if (typeof raw.gas === 'string') out.gas = raw.gas;
		return out;
	}

	function decodePersonalSign(req: PendingRequest): string {
		const candidate = req.params[0];
		if (typeof candidate !== 'string') return '(invalid payload)';
		if (isHex(candidate)) {
			try {
				return hexToString(candidate);
			} catch {
				return candidate;
			}
		}
		return candidate;
	}

	function decodeTypedData(req: PendingRequest): string {
		const candidate = req.params[1];
		if (typeof candidate === 'string') {
			try {
				return JSON.stringify(JSON.parse(candidate), null, 2);
			} catch {
				return candidate;
			}
		}
		if (candidate && typeof candidate === 'object') {
			return JSON.stringify(candidate, null, 2);
		}
		return '(invalid payload)';
	}

	function methodLabel(method: PendingRequest['method']): string {
		switch (method) {
			case 'eth_sendTransaction':
				return 'Send transaction';
			case 'personal_sign':
				return 'Sign message';
			case 'eth_signTypedData_v4':
				return 'Sign typed data';
		}
	}

	function shortAddress(addr: string): string {
		return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
	}
</script>

<Dialog.Root {open} onOpenChange={setOpen}>
	<Dialog.Content class="sm:max-w-md">
		{#if current}
			<Dialog.Header>
				<!-- pr-8 reserves space for the dialog's built-in absolute X close
				     button (top-2 right-2 in dialog-content.svelte) so the origin
				     badge doesn't run under it. -->
				<div class="flex items-center justify-between gap-2 pr-8">
					<Dialog.Title class="font-mono text-sm">{methodLabel(current.method)}</Dialog.Title>
					<Badge variant="outline" class="font-mono text-[10px]">
						{new URL(current.origin).host}
					</Badge>
				</div>
				<Dialog.Description>
					{#if wallet.pending.length > 1}
						{wallet.pending.length} requests pending — review one at a time.
					{:else}
						Review the request below and approve to forward it to the local Hardhat node.
					{/if}
				</Dialog.Description>
			</Dialog.Header>

			<div class="flex flex-col gap-3">
				{#if current.method === 'eth_sendTransaction'}
					{@const tx = decodeTx(current)}
					<dl class="flex flex-col gap-2 font-mono text-[11px]">
						{#if tx.from}
							<div class="flex items-center justify-between gap-2">
								<dt class="text-muted-foreground">From</dt>
								<dd class="break-all text-foreground">{shortAddress(tx.from)}</dd>
							</div>
						{/if}
						{#if tx.to}
							<div class="flex items-center justify-between gap-2">
								<dt class="text-muted-foreground">To</dt>
								<dd class="break-all text-foreground">{shortAddress(tx.to)}</dd>
							</div>
						{/if}
						<div class="flex items-center justify-between gap-2">
							<dt class="text-muted-foreground">Value</dt>
							<dd class="text-foreground">{tx.value ?? '0 ETH'}</dd>
						</div>
						{#if tx.gas}
							<div class="flex items-center justify-between gap-2">
								<dt class="text-muted-foreground">Gas limit</dt>
								<dd class="text-foreground">
									{Number.parseInt(tx.gas, 16).toLocaleString()}
								</dd>
							</div>
						{/if}
						{#if tx.data}
							<Separator />
							<div class="flex flex-col gap-1">
								<dt class="text-muted-foreground">Data</dt>
								<dd
									class="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 break-all"
								>
									{tx.data}
								</dd>
							</div>
						{/if}
					</dl>
				{:else if current.method === 'personal_sign'}
					<div class="flex flex-col gap-1 font-mono text-[11px]">
						<div class="text-muted-foreground">Message</div>
						<pre
							class="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 whitespace-pre-wrap text-foreground">{decodePersonalSign(
								current
							)}</pre>
					</div>
				{:else}
					<div class="flex flex-col gap-1 font-mono text-[11px]">
						<div class="text-muted-foreground">Typed data</div>
						<pre
							class="max-h-56 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 whitespace-pre-wrap text-foreground">{decodeTypedData(
								current
							)}</pre>
					</div>
				{/if}
			</div>

			<Dialog.Footer class="gap-2">
				<Button variant="outline" onclick={() => wallet.reject(current.id)}>Reject</Button>
				<Button onclick={() => wallet.approve(current.id)}>Approve</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
