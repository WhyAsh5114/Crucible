/**
 * Per-workspace chat history persisted as JSONL on the host disk.
 *
 * Path: `${workspaceDir}/.crucible/chat.jsonl` — same root as `state.json`,
 * already bind-mounted into the runner so the log travels with the workspace.
 *
 * `message_delta` and `thinking` token-deltas are coalesced into a single
 * `message` / `thinking` row at flush time. Without coalescing, a multi-minute
 * agent turn would write tens of thousands of one-token lines into the file.
 *
 * Writes are queued through a per-workspace promise chain so concurrent
 * `publishAgentEvent` calls cannot interleave half-written JSON lines.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AgentEventSchema, type AgentEvent } from '@crucible/types';
import { workspaceHostPath } from './workspace-fs';

const CHAT_DIR = '.crucible';
const CHAT_FILE = 'chat.jsonl';

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

  constructor(private readonly workspaceId: string) {}

  private filePath(): string {
    return path.join(workspaceHostPath(this.workspaceId), CHAT_DIR, CHAT_FILE);
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
    const line = `${JSON.stringify(event)}\n`;
    this.writeChain = this.writeChain
      .then(async () => {
        const fp = this.filePath();
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.appendFile(fp, line, 'utf8');
      })
      .catch((err) => {
        // Persistence failures must never propagate into the agent bus.
        console.warn(
          `[chat-log] append failed for workspace ${this.workspaceId}:`,
          err instanceof Error ? err.message : err,
        );
      });
  }
}

const logs = new Map<string, ChatLog>();

function getLog(workspaceId: string): ChatLog {
  let log = logs.get(workspaceId);
  if (!log) {
    log = new ChatLog(workspaceId);
    logs.set(workspaceId, log);
  }
  return log;
}

/** Append (or buffer) one `AgentEvent` for `workspaceId`. */
export function recordChatEvent(workspaceId: string, event: AgentEvent): void {
  getLog(workspaceId).record(event);
}

/**
 * Read the persisted history for `workspaceId`. Flushes any in-memory buffer
 * before reading so callers see the most recent state. Lines that fail schema
 * validation (e.g. partial writes after a crash) are skipped silently.
 */
export async function readChatHistory(workspaceId: string): Promise<AgentEvent[]> {
  await getLog(workspaceId).flush();

  const fp = path.join(workspaceHostPath(workspaceId), CHAT_DIR, CHAT_FILE);
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

/** Drop the in-memory log handle for a workspace (e.g. after deletion). */
export function disposeChatLog(workspaceId: string): void {
  logs.delete(workspaceId);
}
