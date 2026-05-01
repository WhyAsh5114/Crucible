/**
 * EIP-1193 bridge between the preview iframe and the workspace shell.
 *
 * The preview iframe loads `/__crucible/preview-bridge.js` which replaces
 * `window.ethereum` with a postMessage-based provider. This module is the
 * shell-side counterpart: it listens for `crucible-preview-bridge` messages
 * from that iframe, forwards them to the backend `/workspace/:id/rpc`
 * endpoint, and posts back `rpc_response` frames.
 *
 * Security:
 *  - Every incoming message is validated with `PreviewBridgeMessageSchema`.
 *  - Source is checked against `iframeEl.contentWindow` — messages from any
 *    other origin or window are silently dropped.
 *  - The `targetOrigin` for postMessage replies is always the exact
 *    `e.origin` from the original message, never `'*'`.
 */

import {
	PREVIEW_BRIDGE_PROTOCOL,
	PREVIEW_BRIDGE_VERSION,
	PreviewBridgeMessageSchema
} from '@crucible/types';
import type { SensitiveMethod, WalletStore } from '$lib/state/wallet.svelte';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(id: string) {
	return {
		protocol: PREVIEW_BRIDGE_PROTOCOL,
		version: PREVIEW_BRIDGE_VERSION,
		id
	} as const;
}

const SENSITIVE_METHODS: ReadonlySet<SensitiveMethod> = new Set([
	'eth_sendTransaction',
	'personal_sign',
	'eth_signTypedData_v4'
]);

function isSensitive(method: string): method is SensitiveMethod {
	return SENSITIVE_METHODS.has(method as SensitiveMethod);
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Mount the EIP-1193 shell-side message handler.
 *
 * @param workspaceId  Workspace whose `/rpc` endpoint will handle requests.
 * @param iframeEl     The preview iframe element — messages from any other
 *                     source are rejected.
 * @param chainId      Current chain ID as a hex string (e.g. `"0x7a69"`),
 *                     returned synchronously in `hello_ack` without a round-
 *                     trip so the iframe can emit `chainChanged` immediately.
 * @param wallet       Optional wallet store. When provided, sensitive methods
 *                     (`eth_sendTransaction`, `personal_sign`,
 *                     `eth_signTypedData_v4`) are routed through the wallet's
 *                     pending-request queue and only forwarded to `/rpc` after
 *                     the user clicks Approve in the wallet pane.
 * @returns A cleanup function that removes the event listener.
 */
export function createEip1193Bridge(
	workspaceId: string,
	iframeEl: HTMLIFrameElement,
	chainId: string,
	wallet?: WalletStore
): () => void {
	const handler = (e: MessageEvent) => {
		// Drop messages that did not come from the preview iframe.
		if (e.source !== iframeEl.contentWindow) return;

		const parsed = PreviewBridgeMessageSchema.safeParse(e.data);
		if (!parsed.success) return;

		const msg = parsed.data;
		if (msg.direction !== 'preview-to-shell') return;

		const previewOrigin = e.origin;

		if (msg.type === 'hello') {
			iframeEl.contentWindow?.postMessage(
				{
					...makeEnvelope(msg.id),
					direction: 'shell-to-preview',
					type: 'hello_ack',
					chainId
				},
				previewOrigin
			);
			return;
		}

		if (msg.type === 'rpc_request') {
			void handleRpcRequest(
				msg.id,
				msg.method,
				msg.params as unknown[],
				workspaceId,
				iframeEl,
				previewOrigin,
				wallet
			);
			return;
		}

		// `subscribe` frames are received but not acted on in Phase 1.
	};

	window.addEventListener('message', handler);
	return () => window.removeEventListener('message', handler);
}

// Test helpers ----------------------------------------------------------------
// Exported only so tests can clear module-level state between cases where the
// test runner reuses the same process. Not used in production code.
export function __test_clearFailureUntil(): void {
	failureUntil.clear();
}

// ── Internal ─────────────────────────────────────────────────────────────────

// Per-method circuit breaker: when `/rpc` returns 503 (chain unreachable),
// cache the failure for a short window so the dApp's wagmi polls don't flood
// the backend with retries while the chain is down. Cleared on the first
// successful response for the method.
const failureUntil = new Map<string, number>();
const FAILURE_WINDOW_MS = 3000;

async function handleRpcRequest(
	id: string,
	method: string,
	params: unknown[],
	workspaceId: string,
	iframeEl: HTMLIFrameElement,
	previewOrigin: string,
	wallet: WalletStore | undefined
): Promise<void> {
	function reply(
		outcome:
			| { ok: true; result: unknown }
			| { ok: false; code: number; message: string; data?: unknown }
	) {
		iframeEl.contentWindow?.postMessage(
			{
				...makeEnvelope(id),
				direction: 'shell-to-preview',
				type: 'rpc_response',
				outcome
			},
			previewOrigin
		);
	}

	// Short-circuit if this method has been failing recently. wagmi
	// `useBlockNumber({ watch: true })` re-queries on every block (and faster
	// on retry) — without this gate, a dead chain produces hundreds of XHRs
	// per minute against `/rpc`, all returning 503. We still let one through
	// per `FAILURE_WINDOW_MS` so the breaker self-heals once the chain comes
	// back. Sensitive methods bypass the breaker — they're user-initiated, not
	// polled, and the wallet pane needs to enqueue them so the user can act.
	if (!isSensitive(method)) {
		const failingUntil = failureUntil.get(method) ?? 0;
		if (Date.now() < failingUntil) {
			reply({ ok: false, code: -32603, message: 'Chain container is unreachable' });
			return;
		}
	}

	// Sensitive methods (signing + sending) require explicit user approval
	// in the wallet pane before we forward them to the chain. Without a
	// wallet store wired up the request still flows through (preserves
	// pre-wallet-pane behaviour) but we log so it's visible during dev.
	if (wallet && isSensitive(method)) {
		const decision = await wallet.enqueue({ method, params, origin: previewOrigin });
		if (!decision.approved) {
			reply({ ok: false, code: decision.code, message: decision.message });
			return;
		}
	}

	try {
		const res = await fetch(`/api/workspace/${workspaceId}/rpc`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ method, params })
		});

		const data = (await res.json()) as
			| { result: unknown }
			| { error: { code: number; message: string } }
			| { code: string; message: string };

		if (!res.ok) {
			// Non-2xx from the backend (e.g. 503 chain not running, 404 workspace
			// not found). The body uses ApiError format { code, message }, not
			// JSON-RPC error format { error: { code, message } }.
			const apiErr = data as { message?: string };
			if (res.status === 503) {
				failureUntil.set(method, Date.now() + FAILURE_WINDOW_MS);
			}
			reply({ ok: false, code: -32603, message: apiErr.message ?? `HTTP ${res.status}` });
		} else if ('error' in data) {
			reply({ ok: false, code: data.error.code, message: data.error.message });
		} else {
			// Method recovered — clear any cached failure so subsequent calls
			// flow through normally instead of staying short-circuited.
			failureUntil.delete(method);
			reply({ ok: true, result: (data as { result: unknown }).result });
			// A successful eth_sendTransaction changes the connected account's
			// balance — refresh on a short delay so the UI catches the new value
			// after Hardhat mines the tx (default auto-mine on every send).
			if (wallet && method === 'eth_sendTransaction') {
				setTimeout(() => void wallet.refreshBalance(), 250);
			}
		}
	} catch (err) {
		failureUntil.set(method, Date.now() + FAILURE_WINDOW_MS);
		reply({ ok: false, code: -32603, message: String(err) });
	}
}
