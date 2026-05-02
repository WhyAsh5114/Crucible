/**
 * `terminal-mcp` — PTY-backed shell sessions.
 *
 * The terminal is a first-class Crucible surface: the agent narrates progress
 * to it and the user can intervene with manual commands in the same shell.
 */

import { z } from 'zod';
import { TerminalSessionSchema } from '../terminal.ts';
import { TerminalSessionIdSchema, WorkspaceIdSchema } from '../primitives.ts';

export const CreateSessionInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  /** Initial PTY size. Resizable later via `resize`. */
  cols: z.number().int().positive().default(120),
  rows: z.number().int().positive().default(32),
});
export const CreateSessionOutputSchema = TerminalSessionSchema;
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;
export type CreateSessionOutput = z.infer<typeof CreateSessionOutputSchema>;

export const WriteInputSchema = z.object({
  sessionId: TerminalSessionIdSchema,
  /** Raw text written to PTY stdin. */
  text: z.string(),
});
export const WriteOutputSchema = z.object({ success: z.literal(true) });
export type WriteInput = z.infer<typeof WriteInputSchema>;
export type WriteOutput = z.infer<typeof WriteOutputSchema>;

/** Run a command non-interactively and capture full output. Distinct from
 *  `write`, which streams characters into the live PTY. */
export const ExecInputSchema = z.object({
  sessionId: TerminalSessionIdSchema,
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  /** Optional environment overlay applied just to this exec. */
  env: z.object({}).catchall(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
});
export const ExecOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
});
export type ExecInput = z.infer<typeof ExecInputSchema>;
export type ExecOutput = z.infer<typeof ExecOutputSchema>;

export const ResizeInputSchema = z.object({
  sessionId: TerminalSessionIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export const ResizeOutputSchema = z.object({ success: z.literal(true) });
export type ResizeInput = z.infer<typeof ResizeInputSchema>;
export type ResizeOutput = z.infer<typeof ResizeOutputSchema>;

export const tools = {
  create_session: { input: CreateSessionInputSchema, output: CreateSessionOutputSchema },
  write: { input: WriteInputSchema, output: WriteOutputSchema },
  exec: { input: ExecInputSchema, output: ExecOutputSchema },
  resize: { input: ResizeInputSchema, output: ResizeOutputSchema },
} as const;
