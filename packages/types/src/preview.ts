/**
 * Cross-origin EIP-1193 bridge between the preview iframe and the parent shell.
 *
 * The preview runs on its own origin (`https://preview.{workspaceId}.crucible...`)
 * and the shell on `https://crucible...`. The shell owns the authenticated
 * `/ws/rpc` connection; the preview never speaks to it directly. All
 * communication goes through `window.postMessage` with exact-origin checks on
 * both sides (see docs/ARCHITECTURE.md → "Preview Isolation and Wallet Bridge").
 *
 * Every frame is namespaced with `protocol: 'crucible-preview-bridge'` and
 * `version: 1` so the receiver can ignore unrelated messages safely.
 */

import { z } from 'zod';

export const PREVIEW_BRIDGE_PROTOCOL = 'crucible-preview-bridge' as const;
export const PREVIEW_BRIDGE_VERSION = 1 as const;

/** Methods the bridge will forward to the shell-owned RPC proxy. Anything not
 *  on this list MUST be rejected by the shell. The list intentionally
 *  excludes `hardhat_*`, `debug_*`, and any account-management RPC. */
export const ALLOWED_RPC_METHODS = [
  // Read
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_feeHistory',
  'eth_getLogs',
  // Wallet handshake (resolved by the shell, never inside the iframe)
  'eth_accounts',
  'eth_requestAccounts',
  'wallet_switchEthereumChain',
  // Sign + send (the shell shows the approval UI)
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
] as const;
export const AllowedRpcMethodSchema = z.enum(ALLOWED_RPC_METHODS);
export type AllowedRpcMethod = z.infer<typeof AllowedRpcMethodSchema>;

const envelope = z.object({
  protocol: z.literal(PREVIEW_BRIDGE_PROTOCOL),
  version: z.literal(PREVIEW_BRIDGE_VERSION),
  /** Correlates request → response. Required even on push events for tracing. */
  id: z.string().min(1),
});

// --- Preview → Shell --------------------------------------------------------

const Hello = envelope.extend({
  direction: z.literal('preview-to-shell'),
  type: z.literal('hello'),
  /** The preview's own origin, echoed for audit. The shell MUST also check
   *  `event.origin` against its known preview-origin allowlist. */
  origin: z.string(),
});

const RpcRequest = envelope.extend({
  direction: z.literal('preview-to-shell'),
  type: z.literal('rpc_request'),
  method: AllowedRpcMethodSchema,
  params: z.array(z.unknown()),
});

const Subscribe = envelope.extend({
  direction: z.literal('preview-to-shell'),
  type: z.literal('subscribe'),
  /** EIP-1193 events the preview wants forwarded. */
  events: z.array(z.enum(['accountsChanged', 'chainChanged', 'connect', 'disconnect', 'message'])),
});

// --- Shell → Preview --------------------------------------------------------

const HelloAck = envelope.extend({
  direction: z.literal('shell-to-preview'),
  type: z.literal('hello_ack'),
  /** Negotiated chain id, so the preview can render `chainChanged` immediately. */
  chainId: z.string().regex(/^0x[0-9a-f]+$/u),
});

const RpcResponse = envelope.extend({
  direction: z.literal('shell-to-preview'),
  type: z.literal('rpc_response'),
  outcome: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), result: z.unknown() }),
    z.object({
      ok: z.literal(false),
      /** EIP-1193 numeric error code (e.g. 4001 user rejected, 4100 unauthorized). */
      code: z.number().int(),
      message: z.string(),
      data: z.unknown().optional(),
    }),
  ]),
});

const PushEvent = envelope.extend({
  direction: z.literal('shell-to-preview'),
  type: z.literal('event'),
  event: z.enum(['accountsChanged', 'chainChanged', 'connect', 'disconnect', 'message']),
  payload: z.unknown(),
});

export const PreviewBridgeMessageSchema = z.discriminatedUnion('type', [
  Hello,
  RpcRequest,
  Subscribe,
  HelloAck,
  RpcResponse,
  PushEvent,
]);
export type PreviewBridgeMessage = z.infer<typeof PreviewBridgeMessageSchema>;
