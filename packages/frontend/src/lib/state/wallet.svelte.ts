/**
 * Per-workspace wallet store.
 *
 * Holds the connected dev account, balance, and a queue of pending approval
 * requests intercepted by the EIP-1193 bridge (`eth_sendTransaction`,
 * `personal_sign`, `eth_signTypedData_v4`).
 *
 * The bridge calls `enqueue(...)` and awaits the returned promise. The wallet
 * pane renders the queue and resolves/rejects each request when the user
 * clicks Approve / Reject. Approved requests fall through to the existing
 * `POST /api/workspace/:id/rpc` proxy; rejected requests return the standard
 * EIP-1193 user-rejection error (`4001`) to the dApp.
 *
 * Singleton + Svelte context: each workspace shell creates one `WalletStore`
 * and provides it via `setWalletStore`. Both `eip1193-bridge.ts` and
 * `wallet-pane.svelte` consume it through `getWalletStore()`.
 */

import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { formatEther, isAddress, type Address } from 'viem';

export type SensitiveMethod = 'eth_sendTransaction' | 'personal_sign' | 'eth_signTypedData_v4';

export interface PendingRequest {
	id: string;
	method: SensitiveMethod;
	params: unknown[];
	createdAt: number;
	/** Origin (dApp URL) that initiated the request, for display in the UI. */
	origin: string;
}

interface PendingResolver {
	approve: () => void;
	reject: (code: number, message: string) => void;
}

const USER_REJECTED_CODE = 4001;
const USER_REJECTED_MESSAGE = 'User rejected the request.';

/**
 * The rpc proxy returns 503 while the workspace's Hardhat node is still
 * booting (no `chainState` yet). Treating this as a silent no-op avoids
 * console spam during the 30-60s container warm-up window.
 */
function isChainNotReady(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return /HTTP 503\b/.test(err.message);
}

export class WalletStore {
	account = $state<Address | null>(null);
	balanceWei = $state<bigint | null>(null);
	chainId = $state<string | null>(null);
	pending = $state<PendingRequest[]>([]);
	loadingBalance = $state<boolean>(false);
	/**
	 * True while a `refresh()` call is in flight. Drives the wallet pane's
	 * "Connecting…" placeholder so users see the wallet actively booting
	 * rather than a stale "no account" state.
	 */
	refreshing = $state<boolean>(false);
	/** Surfaces the last refresh failure so the wallet pane can show it. */
	lastError = $state<string | null>(null);
	/**
	 * Number of consecutive `refresh()` failures since the last success. The
	 * wallet pane uses this to gate the destructive "couldn't load" UI behind
	 * a few retries so a single transient 503 during chain warmup doesn't
	 * flash an error banner — the page-level retry loop will quietly recover.
	 */
	failedAttempts = $state<number>(0);

	private workspaceId: string | null = null;
	private resolvers = new SvelteMap<string, PendingResolver>();

	/** Human-readable balance, e.g. `"1.234"`. Null when unknown. */
	balanceEth = $derived.by(() => {
		const wei = this.balanceWei;
		if (wei === null) return null;
		const formatted = formatEther(wei);
		// Trim trailing zeros for display while keeping at least 4 decimals.
		const num = Number(formatted);
		if (!Number.isFinite(num)) return formatted;
		return num.toFixed(4).replace(/\.?0+$/u, '') || '0';
	});

	/**
	 * Bind the store to a workspace. Required before `refresh()` can fetch
	 * account / balance via the workspace's RPC proxy.
	 */
	setWorkspace(workspaceId: string): void {
		this.workspaceId = workspaceId;
	}

	/**
	 * Refresh account, chain id, and balance from the workspace's Hardhat
	 * node. Safe to call repeatedly (e.g. after an approved tx). Sets
	 * `refreshing` while in flight and `lastError` if it fails so the wallet
	 * pane can render an honest loading / error state instead of a permanent
	 * "no account". 503s during chain boot are a normal interim state — we
	 * don't surface them as an error and a follow-up call will succeed.
	 */
	async refresh(): Promise<void> {
		if (!this.workspaceId) return;
		this.refreshing = true;
		try {
			const [accounts, chainId] = await Promise.all([
				this.rpc<string[]>('eth_accounts', []),
				this.rpc<string>('eth_chainId', [])
			]);
			this.chainId = chainId;
			const next = accounts[0];
			if (next && isAddress(next)) {
				this.account = next;
				this.lastError = null;
				this.failedAttempts = 0;
				await this.refreshBalance();
			} else {
				this.account = null;
				this.balanceWei = null;
				this.lastError = 'Hardhat returned no dev accounts';
				this.failedAttempts += 1;
			}
		} catch (err) {
			if (isChainNotReady(err)) {
				// Transient — chain is still booting. Count it as a failed attempt
				// so the page-level retry keeps trying, but don't surface it as a
				// hard error in the UI.
				this.failedAttempts += 1;
				return;
			}
			console.warn('[wallet] refresh failed:', err);
			this.lastError = err instanceof Error ? err.message : String(err);
			this.failedAttempts += 1;
		} finally {
			this.refreshing = false;
		}
	}

	/**
	 * Re-query balance for the currently connected account. Called after an
	 * approved transaction so the UI reflects the new balance without a full
	 * `refresh()` round-trip.
	 */
	async refreshBalance(): Promise<void> {
		if (!this.workspaceId || !this.account) return;
		this.loadingBalance = true;
		try {
			const hex = await this.rpc<string>('eth_getBalance', [this.account, 'latest']);
			this.balanceWei = BigInt(hex);
		} catch (err) {
			if (!isChainNotReady(err)) console.warn('[wallet] balance refresh failed:', err);
		} finally {
			this.loadingBalance = false;
		}
	}

	/**
	 * Enqueue a sensitive request from the bridge. Returns a promise that
	 * resolves once the user clicks Approve (the caller then forwards the
	 * call to `/rpc`) or rejects with `{ code: 4001 }` when the user clicks
	 * Reject.
	 */
	enqueue(args: {
		method: SensitiveMethod;
		params: unknown[];
		origin: string;
	}): Promise<{ approved: true } | { approved: false; code: number; message: string }> {
		const id = crypto.randomUUID();
		const request: PendingRequest = {
			id,
			method: args.method,
			params: args.params,
			origin: args.origin,
			createdAt: Date.now()
		};
		this.pending.push(request);

		return new Promise((resolve) => {
			this.resolvers.set(id, {
				approve: () => {
					this.removePending(id);
					resolve({ approved: true });
				},
				reject: (code, message) => {
					this.removePending(id);
					resolve({ approved: false, code, message });
				}
			});
		});
	}

	/** User clicked Approve on a pending request. */
	approve(id: string): void {
		this.resolvers.get(id)?.approve();
	}

	/** User clicked Reject on a pending request. */
	reject(id: string): void {
		this.resolvers.get(id)?.reject(USER_REJECTED_CODE, USER_REJECTED_MESSAGE);
	}

	/** Reject every pending request — used on workspace teardown. */
	rejectAll(): void {
		for (const [, resolver] of this.resolvers) {
			resolver.reject(USER_REJECTED_CODE, USER_REJECTED_MESSAGE);
		}
		this.resolvers.clear();
		this.pending = [];
	}

	private removePending(id: string): void {
		this.resolvers.delete(id);
		this.pending = this.pending.filter((r) => r.id !== id);
	}

	private async rpc<T>(method: string, params: unknown[]): Promise<T> {
		if (!this.workspaceId) throw new Error('wallet store has no workspaceId');
		const res = await fetch(`/api/workspace/${this.workspaceId}/rpc`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ method, params })
		});
		if (!res.ok) throw new Error(`rpc ${method} HTTP ${res.status}`);
		const data = (await res.json()) as { result?: T; error?: { code: number; message: string } };
		if (data.error) throw new Error(`rpc ${method}: ${data.error.message}`);
		return data.result as T;
	}
}

const KEY = Symbol('crucible.wallet-store');

export function setWalletStore(store: WalletStore): void {
	setContext(KEY, store);
}

export function getWalletStore(): WalletStore {
	const store = getContext<WalletStore | undefined>(KEY);
	if (!store) {
		throw new Error('getWalletStore() called without setWalletStore() in an ancestor.');
	}
	return store;
}
