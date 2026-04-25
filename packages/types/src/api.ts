/**
 * HTTP request/response shapes for `/api/*` endpoints.
 *
 * These are the only contracts the SvelteKit frontend uses to talk to the
 * Bun/Hono backend over HTTP. WebSocket frame contracts live in
 * `./agent-events.ts`, `./terminal.ts`, and `./preview.ts`.
 */

import { z } from 'zod';
import {
  AddressSchema,
  BlockNumberSchema,
  ChainIdSchema,
  PublicChainTargetSchema,
  StreamIdSchema,
  WorkspaceIdSchema,
} from './primitives.ts';
import { WorkspaceStateSchema } from './workspace.ts';
import { KeeperHubExecutionSchema } from './ship.ts';

// --- POST /api/workspace -----------------------------------------------------

export const WorkspaceCreateRequestSchema = z.object({
  /** Human display name. The slug-safe `WorkspaceId` is generated server-side. */
  name: z.string().min(1).max(100),
});
export type WorkspaceCreateRequest = z.infer<typeof WorkspaceCreateRequestSchema>;

export const WorkspaceCreateResponseSchema = z.object({
  id: WorkspaceIdSchema,
});
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponseSchema>;

// --- GET /api/workspace/:id --------------------------------------------------

/** Response is `WorkspaceState` from `./workspace.ts`. */
export const WorkspaceGetResponseSchema = WorkspaceStateSchema;
export type WorkspaceGetResponse = z.infer<typeof WorkspaceGetResponseSchema>;

// --- POST /api/prompt --------------------------------------------------------

export const PromptRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  prompt: z.string().min(1).max(8192),
});
export type PromptRequest = z.infer<typeof PromptRequestSchema>;

export const PromptResponseSchema = z.object({
  /** Subscribe to `wss://.../ws/agent?streamId=<id>` to receive `AgentEvent`s. */
  streamId: StreamIdSchema,
});
export type PromptResponse = z.infer<typeof PromptResponseSchema>;

// --- POST /api/chain/fork ----------------------------------------------------

export const ForkRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  rpcUrl: z.url(),
  blockNumber: BlockNumberSchema.optional(),
});
export type ForkRequest = z.infer<typeof ForkRequestSchema>;

export const ForkResponseSchema = z.object({
  rpcUrl: z.url(),
  chainId: ChainIdSchema,
});
export type ForkResponse = z.infer<typeof ForkResponseSchema>;

// --- POST /api/ship ----------------------------------------------------------

export const ShipRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  network: PublicChainTargetSchema,
  /** Address that authorizes the bundle. The actual signing happens in
   *  KeeperHub-managed flows; this is the principal it acts on behalf of. */
  signerAddress: AddressSchema,
});
export type ShipRequest = z.infer<typeof ShipRequestSchema>;

export const ShipResponseSchema = z.object({
  /** One execution record per tx in the ship bundle. */
  executions: z.array(KeeperHubExecutionSchema),
});
export type ShipResponse = z.infer<typeof ShipResponseSchema>;

// --- Error envelope ----------------------------------------------------------

/** Uniform error body for all `/api/*` endpoints. */
export const ApiErrorSchema = z.object({
  code: z.enum([
    'bad_request',
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'rate_limited',
    'internal',
    'runtime_unavailable',
    'inference_unavailable',
    'mesh_unavailable',
    'keeperhub_unavailable',
  ]),
  message: z.string(),
  /** Free-form structured details. Producers MUST NOT include secrets. */
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
