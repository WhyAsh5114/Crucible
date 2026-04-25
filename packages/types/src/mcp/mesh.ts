/**
 * `mesh-mcp` — Gensyn AXL peer-mesh wrapper.
 */

import { z } from 'zod';
import {
  MeshHelpRequestSchema,
  MeshHelpResponseSchema,
  MeshPatchVerificationSchema,
  MeshPeerSchema,
} from '../mesh.ts';
import { HelpRequestIdSchema } from '../primitives.ts';

export const ListPeersInputSchema = z.object({});
export const ListPeersOutputSchema = z.object({ peers: z.array(MeshPeerSchema) });
export type ListPeersOutput = z.infer<typeof ListPeersOutputSchema>;

export const BroadcastHelpInputSchema = MeshHelpRequestSchema.omit({
  reqId: true,
  issuedAt: true,
});
export const BroadcastHelpOutputSchema = z.object({ reqId: HelpRequestIdSchema });
export type BroadcastHelpInput = z.infer<typeof BroadcastHelpInputSchema>;
export type BroadcastHelpOutput = z.infer<typeof BroadcastHelpOutputSchema>;

export const CollectResponsesInputSchema = z.object({
  reqId: HelpRequestIdSchema,
  /** Optional max wait, ms. The server may also enforce a hard cap. */
  waitMs: z.number().int().nonnegative().max(60_000).optional(),
});
export const CollectResponsesOutputSchema = z.object({
  responses: z.array(MeshHelpResponseSchema),
});
export type CollectResponsesInput = z.infer<typeof CollectResponsesInputSchema>;
export type CollectResponsesOutput = z.infer<typeof CollectResponsesOutputSchema>;

export const RespondInputSchema = z.object({
  reqId: HelpRequestIdSchema,
  patch: z.string().min(1),
});
export const RespondOutputSchema = z.object({ ack: z.literal(true) });
export type RespondInput = z.infer<typeof RespondInputSchema>;
export type RespondOutput = z.infer<typeof RespondOutputSchema>;

export const VerifyPeerPatchInputSchema = z.object({
  /** The full peer response being verified. */
  response: MeshHelpResponseSchema,
});
export const VerifyPeerPatchOutputSchema = MeshPatchVerificationSchema;
export type VerifyPeerPatchInput = z.infer<typeof VerifyPeerPatchInputSchema>;
export type VerifyPeerPatchOutput = z.infer<typeof VerifyPeerPatchOutputSchema>;

export const tools = {
  list_peers: { input: ListPeersInputSchema, output: ListPeersOutputSchema },
  broadcast_help: { input: BroadcastHelpInputSchema, output: BroadcastHelpOutputSchema },
  collect_responses: { input: CollectResponsesInputSchema, output: CollectResponsesOutputSchema },
  respond: { input: RespondInputSchema, output: RespondOutputSchema },
  verify_peer_patch: { input: VerifyPeerPatchInputSchema, output: VerifyPeerPatchOutputSchema },
} as const;
