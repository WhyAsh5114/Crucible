/**
 * Helpers for the transaction trace inspector.
 *
 * `TxTrace.decodedCalls` is a flat list with `depth` indicators rather than a
 * nested structure — depth N+1 is a child of the most recent depth-N entry.
 * The inspector renders it as a tree, so we lift the flat list into a real
 * tree once at the top level and let `call-node.svelte` recurse over it.
 */

import type { DecodedCall } from '@crucible/types';

export interface CallTreeNode {
	call: DecodedCall;
	children: CallTreeNode[];
}

/**
 * Convert the trace's flat depth-indexed call list into a nested tree.
 *
 * Walks the list in order, keeping a stack of `(siblings, depth)` frames so
 * each new call attaches to its nearest enclosing parent. Calls that appear
 * out of order (e.g. depth jumps from 0 → 2) are still placed under the
 * deepest open ancestor — defensive against malformed traces.
 */
export function buildCallTree(calls: readonly DecodedCall[]): CallTreeNode[] {
	const root: CallTreeNode[] = [];
	const stack: { siblings: CallTreeNode[]; depth: number }[] = [{ siblings: root, depth: -1 }];

	for (const call of calls) {
		while (stack.length > 1) {
			const top = stack[stack.length - 1]!;
			if (top.depth < call.depth) break;
			stack.pop();
		}
		const parent = stack[stack.length - 1]!;
		const node: CallTreeNode = { call, children: [] };
		parent.siblings.push(node);
		stack.push({ siblings: node.children, depth: call.depth });
	}

	return root;
}

/** Truncate a hex address to `0xabcd…1234`. Returns the input unchanged when it isn't long enough. */
export function shortAddress(addr: string): string {
	if (addr.length < 12) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Truncate a tx hash to `0xabcd…1234`. Same shape as `shortAddress`. */
export function shortHash(hash: string): string {
	return shortAddress(hash);
}

/** Format a wei-or-gas decimal string for display: `42000` → `42,000`. */
export function formatNumeric(value: string): string {
	try {
		return BigInt(value).toLocaleString();
	} catch {
		return value;
	}
}

/**
 * Decode an `Error(string)` ABI-encoded revert payload back to the original
 * string. Returns null if the input doesn't match the standard selector or
 * is malformed. Custom errors (different selectors) return null and the
 * caller should fall back to showing the raw hex.
 *
 * Layout of `Error(string)`:
 *   bytes 0..3   selector       0x08c379a0
 *   bytes 4..35  offset         (always 0x20 in practice)
 *   bytes 36..67 string length  N
 *   bytes 68+    string bytes   (padded to 32-byte boundary)
 */
export function decodeErrorString(data: string): string | null {
	if (typeof data !== 'string' || !data.startsWith('0x08c379a0')) return null;
	try {
		const hex = data.slice(2); // strip 0x
		// selector (8 chars) + offset (64 chars) + length (64 chars) = 136 chars
		const lenHex = hex.slice(8 + 64, 8 + 64 + 64);
		const length = Number(BigInt(`0x${lenHex}`));
		if (!Number.isFinite(length) || length <= 0 || length > 4096) return null;
		const stringStart = 8 + 64 + 64;
		const stringHex = hex.slice(stringStart, stringStart + length * 2);
		// Hex → UTF-8 string. Bun + browser both support TextDecoder.
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			bytes[i] = parseInt(stringHex.slice(i * 2, i * 2 + 2), 16);
		}
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

/**
 * Render a call's args as a compact one-line preview. Hex strings get
 * truncated; large JSON objects get summarised. The full args are still
 * available in the row's expanded details.
 */
export function previewArg(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value === 'string') {
		if (/^0x[0-9a-fA-F]+$/u.test(value) && value.length > 14) {
			return `${value.slice(0, 8)}…${value.slice(-4)}`;
		}
		return JSON.stringify(value);
	}
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		const items = value.slice(0, 3).map((v) => previewArg(v));
		const suffix = value.length > 3 ? `, …+${value.length - 3}` : '';
		return `[${items.join(', ')}${suffix}]`;
	}
	if (typeof value === 'object') {
		try {
			const json = JSON.stringify(value);
			return json.length > 60 ? `${json.slice(0, 57)}…` : json;
		} catch {
			return '[object]';
		}
	}
	return String(value);
}
