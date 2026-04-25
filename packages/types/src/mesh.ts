/**
 * AXL peer mesh — structured help requests and responses exchanged between
 * Crucible nodes. End-to-end encrypted over AXL; no central broker.
 */

import { z } from 'zod';
import { TxTraceSchema } from './deployer.ts';
import {
  HashSchema,
  HelpRequestIdSchema,
  NodeIdSchema,
  PeerIdSchema,
  TimestampMsSchema,
} from './primitives.ts';

export const MeshPeerSchema = z.object({
  nodeId: NodeIdSchema,
  /** Human-readable address advertised by the AXL node (multiaddr or similar).
   *  Optional — peers may be reachable only through the mesh routing layer. */
  endpoint: z.string().optional(),
  lastSeen: TimestampMsSchema,
  /** Reputation score in [0, 1]. The local node maintains this; it is not a
   *  consensus value. */
  reputation: z.number().min(0).max(1),
});
export type MeshPeer = z.infer<typeof MeshPeerSchema>;

export const MeshHelpRequestSchema = z.object({
  reqId: HelpRequestIdSchema,
  revertSignature: z.string().min(1),
  trace: TxTraceSchema,
  ctx: z.object({
    /** The contract source as the requester sees it. */
    contractSource: z.string(),
    /** solc version as a semver string (e.g. `0.8.26`). */
    solcVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }),
  /** Time-to-live in milliseconds. Peers MUST drop the request after this. */
  ttlMs: z.number().int().positive(),
  issuedAt: TimestampMsSchema,
});
export type MeshHelpRequest = z.infer<typeof MeshHelpRequestSchema>;

export const MeshHelpResponseSchema = z.object({
  reqId: HelpRequestIdSchema,
  peerId: PeerIdSchema,
  /** Unified diff the peer is proposing. */
  patch: z.string().min(1),
  /** Verification receipt the peer attaches as evidence the patch worked on
   *  their side. The local node MUST re-verify before applying. */
  verificationReceipt: HashSchema,
  respondedAt: TimestampMsSchema,
});
export type MeshHelpResponse = z.infer<typeof MeshHelpResponseSchema>;

export const MeshPatchVerificationSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('verified'),
    /** Hash of the local snapshot replay that confirmed the patch. */
    localReceipt: HashSchema,
  }),
  z.object({
    result: z.literal('failed'),
    /** Decoded reason the local replay rejected the patch. */
    reason: z.string(),
  }),
]);
export type MeshPatchVerification = z.infer<typeof MeshPatchVerificationSchema>;
