/**
 * Workspace shape returned by `GET /api/workspace/:id` and persisted on the
 * backend volume. The workspace directory on disk is the source of truth for
 * code; this struct is a serializable view of it.
 */

import { z } from 'zod';
import { ChainStateSchema } from './chain.ts';
import { DeploymentRecordSchema } from './deployer.ts';
import {
  TerminalSessionIdSchema,
  TimestampMsSchema,
  WorkspaceIdSchema,
} from './primitives.ts';

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
  /** Active PTY session for this workspace. Null until the runtime has
   *  attached one. */
  terminalSessionId: TerminalSessionIdSchema.nullable(),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
