/**
 * Tests for the terminal MCP server factory and schema validation.
 *
 * Mirrors the pattern in mcp-compiler/test/server.test.ts.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createTerminalServer } from '../src/server.ts';
import {
  CreateSessionInputSchema,
  WriteInputSchema,
  ExecInputSchema,
  ResizeInputSchema,
} from '@crucible/types/mcp/terminal';
import {
  createSession,
  clearAllSessions,
  sessionCount,
  resizeSession,
} from '../src/session-helpers.ts';

// ── Server factory ─────────────────────────────────────────────────────────────

describe('createTerminalServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createTerminalServer({ workspaceRoot: '/tmp' })).not.toThrow();
  });

  it('returns an McpServer instance with a name', () => {
    const server = createTerminalServer({ workspaceRoot: '/tmp' });
    expect(server).toBeDefined();
  });
});

// ── CreateSessionInputSchema ───────────────────────────────────────────────────

describe('CreateSessionInputSchema', () => {
  it('accepts workspaceId alone', () => {
    const result = CreateSessionInputSchema.safeParse({ workspaceId: 'my-workspace' });
    expect(result.success).toBe(true);
  });

  it('applies default cols and rows', () => {
    const result = CreateSessionInputSchema.safeParse({ workspaceId: 'my-workspace' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cols).toBe(120);
      expect(result.data.rows).toBe(32);
    }
  });

  it('accepts custom cols and rows', () => {
    const result = CreateSessionInputSchema.safeParse({
      workspaceId: 'my-workspace',
      cols: 200,
      rows: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cols).toBe(200);
      expect(result.data.rows).toBe(50);
    }
  });

  it('rejects when workspaceId is missing', () => {
    const result = CreateSessionInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects when workspaceId is empty', () => {
    const result = CreateSessionInputSchema.safeParse({ workspaceId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects non-slug workspaceId', () => {
    const result = CreateSessionInputSchema.safeParse({ workspaceId: 'UPPER_CASE' });
    expect(result.success).toBe(false);
  });

  it('rejects zero cols', () => {
    const result = CreateSessionInputSchema.safeParse({ workspaceId: 'ws', cols: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects zero rows', () => {
    const result = CreateSessionInputSchema.safeParse({ workspaceId: 'ws', rows: 0 });
    expect(result.success).toBe(false);
  });
});

// ── WriteInputSchema ───────────────────────────────────────────────────────────

describe('WriteInputSchema', () => {
  it('accepts sessionId and text', () => {
    const result = WriteInputSchema.safeParse({ sessionId: 'pty-abc', text: 'echo hello\n' });
    expect(result.success).toBe(true);
  });

  it('accepts empty text string', () => {
    const result = WriteInputSchema.safeParse({ sessionId: 'pty-abc', text: '' });
    expect(result.success).toBe(true);
  });

  it('rejects when sessionId is missing', () => {
    const result = WriteInputSchema.safeParse({ text: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects when text is missing', () => {
    const result = WriteInputSchema.safeParse({ sessionId: 'pty-abc' });
    expect(result.success).toBe(false);
  });
});

// ── ExecInputSchema ────────────────────────────────────────────────────────────

describe('ExecInputSchema', () => {
  it('accepts sessionId and command', () => {
    const result = ExecInputSchema.safeParse({ sessionId: 'pty-abc', command: 'ls -la' });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = ExecInputSchema.safeParse({
      sessionId: 'pty-abc',
      command: 'echo $FOO',
      cwd: '/workspace/contracts',
      env: { FOO: 'bar' },
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty command', () => {
    const result = ExecInputSchema.safeParse({ sessionId: 'pty-abc', command: '' });
    expect(result.success).toBe(false);
  });

  it('rejects timeoutMs exceeding 300_000', () => {
    const result = ExecInputSchema.safeParse({
      sessionId: 'pty-abc',
      command: 'sleep 1',
      timeoutMs: 400_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when sessionId is missing', () => {
    const result = ExecInputSchema.safeParse({ command: 'ls' });
    expect(result.success).toBe(false);
  });
});

// ── ResizeInputSchema ──────────────────────────────────────────────────────────

describe('ResizeInputSchema', () => {
  it('accepts sessionId, cols, rows', () => {
    const result = ResizeInputSchema.safeParse({ sessionId: 'pty-abc', cols: 120, rows: 40 });
    expect(result.success).toBe(true);
  });

  it('rejects zero cols', () => {
    const result = ResizeInputSchema.safeParse({ sessionId: 'pty-abc', cols: 0, rows: 40 });
    expect(result.success).toBe(false);
  });

  it('rejects zero rows', () => {
    const result = ResizeInputSchema.safeParse({ sessionId: 'pty-abc', cols: 80, rows: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects when sessionId is missing', () => {
    const result = ResizeInputSchema.safeParse({ cols: 80, rows: 40 });
    expect(result.success).toBe(false);
  });
});

// ── Session helpers (unit tests) ───────────────────────────────────────────────

describe('createSession', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it('creates a new session and returns metadata', () => {
    const session = createSession('test-workspace', 120, 32, '/tmp');
    expect(session.workspaceId).toBe('test-workspace');
    expect(session.cols).toBe(120);
    expect(session.rows).toBe(32);
    expect(session.cwd).toBe('/tmp');
    expect(session.sessionId).toMatch(/^pty-/);
    expect(typeof session.startedAt).toBe('number');
  });

  it('returns the same session on repeated calls (idempotent)', () => {
    const a = createSession('test-workspace', 120, 32, '/tmp');
    const b = createSession('test-workspace', 80, 24, '/tmp');
    expect(a.sessionId).toBe(b.sessionId);
  });

  it('uses default cols=120 and rows=32 when undefined', () => {
    const session = createSession('ws-defaults', undefined, undefined, '/tmp');
    expect(session.cols).toBe(120);
    expect(session.rows).toBe(32);
  });

  it('increments session count', () => {
    expect(sessionCount()).toBe(0);
    createSession('workspace-a', 120, 32, '/tmp');
    expect(sessionCount()).toBe(1);
    createSession('workspace-b', 120, 32, '/tmp');
    expect(sessionCount()).toBe(2);
    createSession('workspace-a', 120, 32, '/tmp'); // idempotent, same workspace
    expect(sessionCount()).toBe(2);
  });
});

describe('resizeSession', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it('updates dimensions for an existing session', () => {
    const session = createSession('ws-resize', 120, 32, '/tmp');
    const ok = resizeSession(session.sessionId, 200, 50);
    expect(ok).toBe(true);
  });

  it('returns false for an unknown sessionId', () => {
    const ok = resizeSession('nonexistent-session', 80, 24);
    expect(ok).toBe(false);
  });
});

describe('clearAllSessions', () => {
  it('empties the session store', () => {
    createSession('ws1', 120, 32, '/tmp');
    createSession('ws2', 120, 32, '/tmp');
    expect(sessionCount()).toBe(2);
    clearAllSessions();
    expect(sessionCount()).toBe(0);
  });
});
