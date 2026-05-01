/**
 * Tests for the EIP-1193 shell-side bridge.
 *
 * Uses Bun's happy-dom environment (configured in bunfig.toml) so browser
 * APIs — window, document, HTMLIFrameElement, MessageEvent — are real DOM
 * objects, not mocks.
 */

/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createEip1193Bridge, __test_clearFailureUntil } from '../src/lib/eip1193-bridge';
import {
	PREVIEW_BRIDGE_PROTOCOL,
	PREVIEW_BRIDGE_VERSION,
	ALLOWED_RPC_METHODS
} from '@crucible/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'test-workspace';
const CHAIN_ID = '0x7a69';

/** Build a well-formed crucible-preview-bridge envelope. */
function envelope(overrides: Record<string, unknown>) {
	return {
		protocol: PREVIEW_BRIDGE_PROTOCOL,
		version: PREVIEW_BRIDGE_VERSION,
		id: 'test-id-1',
		direction: 'preview-to-shell',
		...overrides
	};
}

/** Dispatch a MessageEvent on window as if it arrived from `source`. */
function dispatchFrom(source: WindowProxy | null, data: unknown) {
	const evt = new MessageEvent('message', {
		data,
		source,
		origin: 'http://localhost:5174'
	});
	window.dispatchEvent(evt);
}

// ── Captured postMessages ────────────────────────────────────────────────────

interface CapturedPost {
	data: unknown;
	targetOrigin: string;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createEip1193Bridge', () => {
	let iframe: HTMLIFrameElement;
	let posted: CapturedPost[];
	let cleanup: () => void;
	let originalFetch: typeof fetch;

	beforeEach(() => {
		iframe = document.createElement('iframe');
		document.body.appendChild(iframe);
		posted = [];
		originalFetch = globalThis.fetch;

		// Clear module-level circuit-breaker state so tests don't interfere
		// with one another when the runner reuses the same process.
		__test_clearFailureUntil();

		// Capture postMessage calls sent by the bridge to the iframe's window.
		// In happy-dom, iframe.contentWindow is available once attached to body.
		// We replace postMessage entirely — the spy captures calls without
		// forwarding to the real implementation (which enforces origin matching
		// and would throw SecurityError because the iframe has no loaded URL).
		if (iframe.contentWindow) {
			const spy = (data: unknown, targetOrigin: string) => {
				posted.push({ data, targetOrigin });
			};
			// Cast through unknown to satisfy the overloaded postMessage signature.
			iframe.contentWindow.postMessage = spy as unknown as typeof iframe.contentWindow.postMessage;
		}

		cleanup = createEip1193Bridge(WORKSPACE_ID, iframe, CHAIN_ID);
	});

	afterEach(() => {
		cleanup();
		document.body.removeChild(iframe);
		globalThis.fetch = originalFetch;
	});

	// ── Source validation ────────────────────────────────────────────────────

	describe('source validation', () => {
		it('drops messages whose source is not the iframe contentWindow', () => {
			dispatchFrom(window, envelope({ type: 'hello', origin: 'http://localhost:5174' }));
			expect(posted).toHaveLength(0);
		});

		it('drops messages with wrong protocol', () => {
			dispatchFrom(iframe.contentWindow, {
				protocol: 'other',
				version: 1,
				id: '1',
				direction: 'preview-to-shell',
				type: 'hello',
				origin: 'x'
			});
			expect(posted).toHaveLength(0);
		});

		it('drops messages with wrong version', () => {
			dispatchFrom(iframe.contentWindow, {
				...envelope({ type: 'hello', origin: 'http://localhost:5174' }),
				version: 99
			});
			expect(posted).toHaveLength(0);
		});

		it('drops messages with shell-to-preview direction', () => {
			dispatchFrom(iframe.contentWindow, {
				...envelope({ type: 'hello_ack', chainId: '0x1' }),
				direction: 'shell-to-preview'
			});
			expect(posted).toHaveLength(0);
		});
	});

	// ── hello handshake ──────────────────────────────────────────────────────

	describe('hello handshake', () => {
		it('responds to a hello frame with a hello_ack containing the chainId', () => {
			if (!iframe.contentWindow) return; // skip if happy-dom does not support contentWindow
			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'hello', origin: 'http://localhost:5174' })
			);
			expect(posted).toHaveLength(1);
			const reply = posted[0]?.data as Record<string, unknown>;
			expect(reply.type).toBe('hello_ack');
			expect(reply.chainId).toBe(CHAIN_ID);
			expect(reply.direction).toBe('shell-to-preview');
			expect(reply.id).toBe('test-id-1');
		});

		it('sends hello_ack to the exact origin from the event', () => {
			if (!iframe.contentWindow) return;
			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'hello', origin: 'http://localhost:5174' })
			);
			expect(posted[0]?.targetOrigin).toBe('http://localhost:5174');
		});
	});

	// ── rpc_request → fetch → rpc_response ──────────────────────────────────

	describe('rpc_request forwarding', () => {
		it('calls fetch /api/workspace/:id/rpc and posts rpc_response on success', async () => {
			if (!iframe.contentWindow) return;

			globalThis.fetch = (async () =>
				new Response(JSON.stringify({ result: '0x7a69' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})) as unknown as typeof fetch;

			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'rpc_request', method: 'eth_chainId', params: [] })
			);

			// Bridge dispatches the fetch asynchronously — wait a tick.
			await new Promise((r) => setTimeout(r, 10));

			expect(posted.length).toBeGreaterThanOrEqual(1);
			const reply = posted[posted.length - 1]?.data as Record<string, unknown>;
			expect(reply.type).toBe('rpc_response');
			expect((reply.outcome as { ok: boolean }).ok).toBe(true);
			expect((reply.outcome as { result: string }).result).toBe('0x7a69');
		});

		it('posts rpc_response with ok:false when the backend returns an error', async () => {
			if (!iframe.contentWindow) return;

			globalThis.fetch = (async () =>
				new Response(JSON.stringify({ error: { code: -32000, message: 'No node' } }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})) as unknown as typeof fetch;

			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'rpc_request', method: 'eth_blockNumber', params: [] })
			);

			await new Promise((r) => setTimeout(r, 10));

			const reply = posted[posted.length - 1]?.data as Record<string, unknown>;
			expect(reply.type).toBe('rpc_response');
			const outcome = reply.outcome as { ok: boolean; code: number; message: string };
			expect(outcome.ok).toBe(false);
			expect(outcome.code).toBe(-32000);
			expect(outcome.message).toBe('No node');
		});

		it('posts rpc_response with ok:false when fetch throws', async () => {
			if (!iframe.contentWindow) return;

			globalThis.fetch = (async () => {
				throw new Error('network error');
			}) as unknown as typeof fetch;

			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'rpc_request', method: 'eth_chainId', params: [] })
			);

			await new Promise((r) => setTimeout(r, 10));

			const reply = posted[posted.length - 1]?.data as Record<string, unknown>;
			expect(reply.type).toBe('rpc_response');
			expect((reply.outcome as { ok: boolean }).ok).toBe(false);
		});

		it('includes credentials: include in the fetch call', async () => {
			if (!iframe.contentWindow) return;

			let capturedInit: RequestInit | undefined;
			globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
				capturedInit = init;
				return new Response(JSON.stringify({ result: '0x0' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}) as unknown as typeof fetch;

			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'rpc_request', method: 'eth_chainId', params: [] })
			);

			await new Promise((r) => setTimeout(r, 10));

			expect(capturedInit?.credentials).toBe('include');
		});
	});

	// ── cleanup ──────────────────────────────────────────────────────────────

	describe('cleanup', () => {
		it('stops handling messages after cleanup is called', () => {
			if (!iframe.contentWindow) return;

			cleanup();

			dispatchFrom(
				iframe.contentWindow,
				envelope({ type: 'hello', origin: 'http://localhost:5174' })
			);

			expect(posted).toHaveLength(0);

			// Re-create so afterEach cleanup() doesn't throw.
			cleanup = createEip1193Bridge(WORKSPACE_ID, iframe, CHAIN_ID);
		});
	});

	// ── allowed methods coverage ─────────────────────────────────────────────

	describe('ALLOWED_RPC_METHODS list', () => {
		it('contains the four Phase-1 required methods', () => {
			expect(ALLOWED_RPC_METHODS).toContain('eth_requestAccounts');
			expect(ALLOWED_RPC_METHODS).toContain('eth_chainId');
			expect(ALLOWED_RPC_METHODS).toContain('eth_sendTransaction');
			expect(ALLOWED_RPC_METHODS).toContain('eth_call');
		});

		it('does not contain hardhat_ methods', () => {
			const hardhat = (ALLOWED_RPC_METHODS as readonly string[]).filter((m) =>
				m.startsWith('hardhat_')
			);
			expect(hardhat).toHaveLength(0);
		});

		it('does not contain debug_ methods', () => {
			const debug = (ALLOWED_RPC_METHODS as readonly string[]).filter((m) =>
				m.startsWith('debug_')
			);
			expect(debug).toHaveLength(0);
		});
	});
});
