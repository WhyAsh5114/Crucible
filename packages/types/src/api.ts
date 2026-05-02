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
import { WorkspaceStateSchema, WorkspaceFileSchema } from './workspace.ts';
import { KeeperHubExecutionSchema } from './ship.ts';

// --- POST /api/workspace -----------------------------------------------------

/**
 * Workspace template — picks the initial scaffold (contracts + frontend code)
 * the workspace boots with. Catalogued in `@crucible/backend` `template-registry.ts`.
 *
 * - `counter` — the original DemoVault scaffold; seeds a deliberately broken
 *   `onlyOwner` so the agent's self-heal demo has something to fix.
 * - `uniswap-v3` — Hardhat-fork-of-mainnet template; frontend swaps WETH↔USDC
 *   via Uniswap V3's SwapRouter on the forked chain.
 * - `nft-mint` — minimal ERC-721 with a public mint button — the simplest
 *   "real on-chain action" demo.
 */
export const WorkspaceTemplateSchema = z.enum(['counter', 'uniswap-v3', 'nft-mint']);
export type WorkspaceTemplate = z.infer<typeof WorkspaceTemplateSchema>;

export const WorkspaceCreateRequestSchema = z.object({
  /** Human display name. The slug-safe `WorkspaceId` is generated server-side. */
  name: z.string().min(1).max(100),
  /**
   * Initial scaffold to drop into the workspace. Defaults to `counter` so
   * old clients that don't pass a template keep their existing behaviour.
   */
  template: WorkspaceTemplateSchema.optional(),
});
export type WorkspaceCreateRequest = z.infer<typeof WorkspaceCreateRequestSchema>;

export const WorkspaceCreateResponseSchema = z.object({
  id: WorkspaceIdSchema,
});
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponseSchema>;

// --- PATCH /api/workspace/:id (rename) ---------------------------------------

export const WorkspaceUpdateRequestSchema = z.object({
  name: z.string().min(1).max(100),
});
export type WorkspaceUpdateRequest = z.infer<typeof WorkspaceUpdateRequestSchema>;

export const WorkspaceUpdateResponseSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1),
});
export type WorkspaceUpdateResponse = z.infer<typeof WorkspaceUpdateResponseSchema>;

// --- DELETE /api/workspace/:id -----------------------------------------------

export const WorkspaceDeleteResponseSchema = z.object({
  id: WorkspaceIdSchema,
  deleted: z.literal(true),
});
export type WorkspaceDeleteResponse = z.infer<typeof WorkspaceDeleteResponseSchema>;

// --- GET /api/workspace/:id --------------------------------------------------

/** Response is `WorkspaceState` from `./workspace.ts`. */
export const WorkspaceGetResponseSchema = WorkspaceStateSchema;
export type WorkspaceGetResponse = z.infer<typeof WorkspaceGetResponseSchema>;

// --- GET /api/workspaces -----------------------------------------------------

export const WorkspaceSummarySchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  /** Most recent runtime status, or null if the workspace has never booted. */
  runtimeStatus: z.enum(['starting', 'ready', 'degraded', 'crashed', 'stopped']).nullable(),
  /**
   * Initial scaffold template the workspace was created with. Old rows
   * predating the template column read back as `'counter'` via the DB
   * default, so this is always populated for the list UI.
   */
  template: WorkspaceTemplateSchema.default('counter'),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
});
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;

// --- PUT /api/workspace/:id/file ---------------------------------------------

export const FileWriteRequestSchema = z.object({
  /** Workspace-relative POSIX path (e.g. `contracts/Vault.sol`). Must not contain `..`. */
  path: z
    .string()
    .min(1)
    .max(512)
    .refine((p) => !p.includes('..') && !p.startsWith('/'), {
      message: 'path must be relative and must not contain ..',
    }),
  content: z.string().max(512 * 1024),
});
export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;

export const FileWriteResponseSchema = WorkspaceFileSchema;
export type FileWriteResponse = z.infer<typeof FileWriteResponseSchema>;

// --- Chat sessions -----------------------------------------------------------

export const ChatSessionSchema = z.object({
  id: z.string(),
  workspaceId: WorkspaceIdSchema,
  title: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const ChatSessionListResponseSchema = z.object({
  sessions: z.array(ChatSessionSchema),
});
export type ChatSessionListResponse = z.infer<typeof ChatSessionListResponseSchema>;

export const ChatSessionCreateRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type ChatSessionCreateRequest = z.infer<typeof ChatSessionCreateRequestSchema>;

export const ChatSessionRenameRequestSchema = z.object({
  title: z.string().min(1).max(200),
});
export type ChatSessionRenameRequest = z.infer<typeof ChatSessionRenameRequestSchema>;

export const ChatSessionDeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
});
export type ChatSessionDeleteResponse = z.infer<typeof ChatSessionDeleteResponseSchema>;

// --- POST /api/prompt --------------------------------------------------------

export const PromptRequestSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  /** ID of the chat session to append this turn to. If absent the most recent
   *  session is used; if none exist a "Chat 1" session is created automatically. */
  sessionId: z.string().optional(),
  prompt: z.string().min(1).max(8192),
  /**
   * When true, skip the 0G Compute Router and use the OpenAI-compatible
   * fallback endpoint. Set by the frontend's "Retry with OpenAI" button after
   * a Router failure so the user can recover without changing server config.
   */
  force_openai_fallback: z.boolean().optional(),
  /**
   * Model override for the OpenAI-compatible fallback path. When provided
   * with `force_openai_fallback: true`, uses this model instead of
   * `OPENAI_MODEL` from the environment.
   */
  model: z.string().optional(),
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
