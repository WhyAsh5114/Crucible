/**
 * Workspace shape returned by `GET /api/workspace/:id` and persisted on the
 * backend volume. The workspace directory on disk is the source of truth for
 * code; this struct is a serializable view of it.
 */

import { z } from 'zod';
import { ChainStateSchema } from './chain.ts';
import { DeploymentRecordSchema } from './deployer.ts';
import { TerminalSessionIdSchema, TimestampMsSchema, WorkspaceIdSchema } from './primitives.ts';

export const WorkspaceFileLangSchema = z.enum([
  'solidity',
  'typescript',
  'javascript',
  'svelte',
  'json',
  'css',
  'html',
  'markdown',
  'plaintext',
]);
export type WorkspaceFileLang = z.infer<typeof WorkspaceFileLangSchema>;

export const WorkspaceFileSchema = z.object({
  /** Workspace-relative POSIX path (e.g. `contracts/Vault.sol`). */
  path: z.string().min(1),
  content: z.string(),
  lang: WorkspaceFileLangSchema,
  /** Backend-computed sha256 hex of `content`. Used for cheap change detection. */
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  /** Last modification time as observed by the backend filesystem watcher. */
  modifiedAt: TimestampMsSchema,
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

/**
 * Lifecycle phase the per-workspace preview supervisor is currently in.
 *
 * The frontend uses this to render an honest boot screen instead of a generic
 * "Preview not ready". The slowest leg is `installing` (host-side `bun
 * install` for the workspace's frontend, 30–60s on cold cache); without
 * surfacing it the iframe pane appears stuck.
 */
export const PreviewPhaseSchema = z.enum([
  /** No preview attempt yet (e.g. workspace just created). */
  'idle',
  /** `bun install` running in the workspace's `frontend/` directory. */
  'installing',
  /** Vite dev server spawned but hasn't bound a port yet. */
  'starting',
  /** Dev server reachable; `previewUrl` is set. */
  'ready',
  /** Install or start failed. Inspect `logTail` for the reason. */
  'failed',
]);
export type PreviewPhase = z.infer<typeof PreviewPhaseSchema>;

export const PreviewStateSchema = z.object({
  phase: PreviewPhaseSchema,
  /**
   * Tail of recent stdout/stderr lines from `bun install` and `vite dev`.
   * Capped at a small number of lines on the backend so the workspace
   * polling response stays small. Empty array when nothing has been logged.
   */
  logTail: z.array(z.string()),
  /** ms-since-epoch the supervisor last transitioned `phase`. */
  updatedAt: TimestampMsSchema,
});
export type PreviewState = z.infer<typeof PreviewStateSchema>;

/**
 * Lifecycle phase for the workspace's default Counter template — compiled
 * and deployed automatically on first boot so the preview iframe lands on a
 * live contract address. The boot overlay gates on this transitioning to a
 * settled state (`ready` / `failed` / `unavailable`) so the iframe doesn't
 * appear before contracts.json is written.
 */
export const TemplatePhaseSchema = z.enum([
  /** No deploy attempt yet. */
  'idle',
  /** Hardhat compile in progress. */
  'compiling',
  /** Compile succeeded; deploy_local in progress. */
  'deploying',
  /** contracts.json written; preview can fetch it. */
  'ready',
  /** Compile or deploy errored. */
  'failed',
  /** Workspace has no Counter.sol — agent removed/replaced it. Boot proceeds. */
  'unavailable',
]);
export type TemplatePhase = z.infer<typeof TemplatePhaseSchema>;

export const TemplateStateSchema = z.object({
  phase: TemplatePhaseSchema,
  /** Deployed Counter address once `phase === 'ready'`. */
  contractAddress: z.string().nullable(),
  /** Latest non-empty status / error message from the deploy chain. */
  message: z.string().nullable(),
  updatedAt: TimestampMsSchema,
});
export type TemplateState = z.infer<typeof TemplateStateSchema>;

export const WorkspaceStateSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1),
  createdAt: TimestampMsSchema,
  /** Null while the workspace runtime is still booting. */
  chainState: ChainStateSchema.nullable(),
  deployments: z.array(DeploymentRecordSchema),
  files: z.array(WorkspaceFileSchema),
  /** Readable preview URL (Portless locally, real subdomain in hosted mode).
   *  Null until the preview supervisor reports the dev server as ready. */
  previewUrl: z.url().nullable(),
  /** Live phase + log tail from the preview supervisor so the UI can show
   *  install/start progress instead of a generic "DEGRADED" state. */
  previewState: PreviewStateSchema,
  /** Live phase for the auto-deployed Counter template — gates the boot
   *  overlay so the preview iframe doesn't render before contracts.json. */
  templateState: TemplateStateSchema,
  /** Active PTY session for this workspace. Null until the runtime has
   *  attached one. */
  terminalSessionId: TerminalSessionIdSchema.nullable(),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
