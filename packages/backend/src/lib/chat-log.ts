/**
 * Per-session chat history persisted as JSONL on the host disk.
 *
 * Path: `${workspaceDir}/.crucible/sessions/${sessionId}.jsonl`
 *
 * Each `ChatSession` in the DB corresponds to one JSONL file. Sessions allow
 * users to maintain separate, focused chat contexts for a workspace instead
 * of one unbounded history.
 *
 * Legacy migration: if `chat.jsonl` (the old single-file format) exists for
 * a workspace it is treated as the backing file for a session whose id is
 * the special string `"legacy"`. The migration endpoint moves it to a real
 * session file on first session creation.
 *
 * `message_delta` and `thinking` token-deltas are coalesced into a single
 * `message` / `thinking` row at flush time. Without coalescing, a multi-minute
 * agent turn would write tens of thousands of one-token lines into the file.
 *
 * Writes are queued through a per-session promise chain so concurrent
 * `publishAgentEvent` calls cannot interleave half-written JSON lines.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AgentEventSchema, type AgentEvent } from '@crucible/types';
import { workspaceHostPath } from './workspace-fs';

const CHAT_DIR = '.crucible';
const SESSIONS_DIR = 'sessions';
const LEGACY_FILE = 'chat.jsonl';

interface DeltaBuffer {
  streamId: AgentEvent['streamId'];
  seq: number;
  emittedAt: number;
  text: string;
}

class ChatLog {
  private writeChain: Promise<void> = Promise.resolve();
  private pendingMessage: DeltaBuffer | null = null;
  private pendingThinking: DeltaBuffer | null = null;

  constructor(
    private readonly workspaceId: string,
    private readonly sessionId: string,
  ) {}

  private filePath(): string {
    return path.join(
      workspaceHostPath(this.workspaceId),
      CHAT_DIR,
      SESSIONS_DIR,
      `${this.sessionId}.jsonl`,
    );
  }

  record(event: AgentEvent): void {
    if (event.type === 'message_delta') {
      if (this.pendingMessage && this.pendingMessage.streamId === event.streamId) {
        this.pendingMessage.text += event.text;
      } else {
        this.flushMessage();
        this.pendingMessage = {
          streamId: event.streamId,
          seq: event.seq,
          emittedAt: event.emittedAt,
          text: event.text,
        };
      }
      return;
    }

    if (event.type === 'thinking') {
      if (this.pendingThinking && this.pendingThinking.streamId === event.streamId) {
        this.pendingThinking.text += event.text;
      } else {
        this.flushThinking();
        this.pendingThinking = {
          streamId: event.streamId,
          seq: event.seq,
          emittedAt: event.emittedAt,
          text: event.text,
        };
      }
      return;
    }

    // Any non-delta event closes the pending buffers in order so the on-disk
    // sequence matches the wire order the frontend would have seen.
    this.flushThinking();
    this.flushMessage();
    this.append(event);
  }

  /** Flush any in-memory delta buffers and resolve once disk writes have drained. */
  async flush(): Promise<void> {
    this.flushThinking();
    this.flushMessage();
    await this.writeChain;
  }

  private flushMessage(): void {
    if (!this.pendingMessage) return;
    const buf = this.pendingMessage;
    this.pendingMessage = null;
    const candidate: unknown = {
      type: 'message',
      streamId: buf.streamId,
      seq: buf.seq,
      emittedAt: buf.emittedAt,
      content: buf.text,
    };
    const validated = AgentEventSchema.safeParse(candidate);
    if (validated.success) this.append(validated.data);
  }

  private flushThinking(): void {
    if (!this.pendingThinking) return;
    const buf = this.pendingThinking;
    this.pendingThinking = null;
    const candidate: unknown = {
      type: 'thinking',
      streamId: buf.streamId,
      seq: buf.seq,
      emittedAt: buf.emittedAt,
      text: buf.text,
    };
    const validated = AgentEventSchema.safeParse(candidate);
    if (validated.success) this.append(validated.data);
  }

  private append(event: AgentEvent): void {
    const line = `${JSON.stringify(event, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}\n`;
    this.writeChain = this.writeChain
      .then(async () => {
        const fp = this.filePath();
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.appendFile(fp, line, 'utf8');
      })
      .catch((err) => {
        // Persistence failures must never propagate into the agent bus.
        console.warn(
          `[chat-log] append failed for workspace ${this.workspaceId} session ${this.sessionId}:`,
          err instanceof Error ? err.message : err,
        );
      });
  }
}

// In-memory map keyed by `${workspaceId}:${sessionId}`.
const logs = new Map<string, ChatLog>();

function logKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function getLog(workspaceId: string, sessionId: string): ChatLog {
  const key = logKey(workspaceId, sessionId);
  let log = logs.get(key);
  if (!log) {
    log = new ChatLog(workspaceId, sessionId);
    logs.set(key, log);
  }
  return log;
}

/** Append (or buffer) one `AgentEvent` for the given workspace + session. */
export function recordChatEvent(workspaceId: string, sessionId: string, event: AgentEvent): void {
  getLog(workspaceId, sessionId).record(event);
}

/**
 * Read the persisted history for `workspaceId` + `sessionId`. Flushes any
 * in-memory buffer before reading so callers see the most recent state. Lines
 * that fail schema validation (e.g. partial writes after a crash) are skipped
 * silently.
 */
export async function readChatHistory(
  workspaceId: string,
  sessionId: string,
): Promise<AgentEvent[]> {
  await getLog(workspaceId, sessionId).flush();

  const fp = path.join(
    workspaceHostPath(workspaceId),
    CHAT_DIR,
    SESSIONS_DIR,
    `${sessionId}.jsonl`,
  );
  let raw: string;
  try {
    raw = await fs.readFile(fp, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const events: AgentEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const validated = AgentEventSchema.safeParse(parsed);
    if (validated.success) events.push(validated.data);
  }
  return events;
}

/**
 * Migrate the legacy `chat.jsonl` file (pre-sessions) for a workspace into a
 * dedicated session file. Returns `true` if migration happened, `false` if
 * there was nothing to migrate.
 */
export async function migrateLegacyChatLog(
  workspaceId: string,
  targetSessionId: string,
): Promise<boolean> {
  const baseDir = path.join(workspaceHostPath(workspaceId), CHAT_DIR);
  const legacyPath = path.join(baseDir, LEGACY_FILE);
  const targetPath = path.join(baseDir, SESSIONS_DIR, `${targetSessionId}.jsonl`);
  try {
    await fs.mkdir(path.join(baseDir, SESSIONS_DIR), { recursive: true });
    await fs.rename(legacyPath, targetPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Drop the in-memory log handle(s) for a workspace. Optionally scoped to one
 *  session; omitting `sessionId` disposes all sessions for the workspace. */
export function disposeChatLog(workspaceId: string, sessionId?: string): void {
  if (sessionId !== undefined) {
    logs.delete(logKey(workspaceId, sessionId));
  } else {
    for (const key of [...logs.keys()]) {
      if (key.startsWith(`${workspaceId}:`)) logs.delete(key);
    }
  }
}
