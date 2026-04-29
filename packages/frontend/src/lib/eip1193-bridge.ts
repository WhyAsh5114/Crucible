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

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEnvelope(id: string) {
	return {
		protocol: PREVIEW_BRIDGE_PROTOCOL,
		version: PREVIEW_BRIDGE_VERSION,
		id
	} as const;
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
 * @returns A cleanup function that removes the event listener.
 */
export function createEip1193Bridge(
	workspaceId: string,
	iframeEl: HTMLIFrameElement,
	chainId: string
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
				previewOrigin
			);
			return;
		}

		// `subscribe` frames are received but not acted on in Phase 1.
	};

	window.addEventListener('message', handler);
	return () => window.removeEventListener('message', handler);
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function handleRpcRequest(
	id: string,
	method: string,
	params: unknown[],
	workspaceId: string,
	iframeEl: HTMLIFrameElement,
	previewOrigin: string
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

	try {
		const res = await fetch(`/api/workspace/${workspaceId}/rpc`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ method, params })
		});

		const data = (await res.json()) as
			| { result: unknown }
			| { error: { code: number; message: string } };

		if ('error' in data) {
			reply({ ok: false, code: data.error.code, message: data.error.message });
		} else {
			reply({ ok: true, result: data.result });
		}
	} catch (err) {
		reply({ ok: false, code: -32603, message: String(err) });
	}
}
