/**
 * Per-workspace PTY-backed terminal session, shared by the user and the agent.
 */

import { z } from 'zod';
import { TerminalSessionIdSchema, TimestampMsSchema, WorkspaceIdSchema } from './primitives.ts';

export const TerminalSessionSchema = z.object({
  sessionId: TerminalSessionIdSchema,
  workspaceId: WorkspaceIdSchema,
  /** Initial working directory. The session may `cd` later — this field is the
   *  start cwd, not the live cwd. */
  cwd: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  startedAt: TimestampMsSchema,
});
export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

/**
 * Streamed over `wss://.../ws/terminal?sessionId=<id>`. The server emits
 * `data` frames for stdout/stderr; the client emits `data` for stdin and
 * `resize` when the UI changes size. `exit` is server-emitted only.
 */
export const TerminalFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('data'), data: z.string() }),
  z.object({
    kind: z.literal('resize'),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('exit'), exitCode: z.number().int() }),
]);
export type TerminalFrame = z.infer<typeof TerminalFrameSchema>;
