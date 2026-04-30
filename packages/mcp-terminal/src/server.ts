/**
 * McpServer factory for mcp-terminal.
 *
 * Registers four tools — create_session, write, exec, resize — using schemas
 * from @crucible/types/mcp/terminal. All session state lives in
 * session-helpers.ts so this module and index.ts share the same in-memory map
 * regardless of whether a request arrives via MCP or the REST endpoint.
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  CreateSessionInputSchema,
  WriteInputSchema,
  ExecInputSchema,
  ResizeInputSchema,
  type CreateSessionInput,
  type WriteInput,
  type ExecInput,
  type ResizeInput,
} from '@crucible/types/mcp/terminal';
import { createSession, writeSession, execCommand, resizeSession } from './session-helpers.ts';

// ── Logging ───────────────────────────────────────────────────────────────────

const TAG = '[mcp-terminal]';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
const logWarn = (msg: string) => console.warn(`${TAG} ${msg}`);
const logError = (msg: string) => console.error(`${TAG} ${msg}`);

// ── Result helpers ────────────────────────────────────────────────────────────

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export type CreateTerminalServerOptions = {
  workspaceRoot: string;
};

export function createTerminalServer(opts: CreateTerminalServerOptions): McpServer {
  const { workspaceRoot } = opts;

  const server = new McpServer({
    name: 'crucible-terminal',
    version: '0.0.0',
  });

  // ── create_session ──────────────────────────────────────────────────────────

  server.registerTool(
    'create_session',
    {
      title: 'Create Terminal Session',
      description:
        'Get or create the per-workspace bash session. ' +
        'Each workspace has exactly one interactive session; calling this again returns the existing one. ' +
        'Returns sessionId, cwd, and terminal dimensions. ' +
        'Use the returned sessionId with write, exec, and resize.',
      inputSchema: CreateSessionInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, cols, rows }: CreateSessionInput) => {
      try {
        log(`tool:create_session workspace=${workspaceId}`);
        const session = createSession(workspaceId, cols, rows, workspaceRoot);
        log(`tool:create_session ok sessionId=${session.sessionId}`);
        return toolResult(session);
      } catch (err) {
        logError(`tool:create_session error: ${String(err)}`);
        return errorResult(`create_session failed: ${String(err)}`);
      }
    },
  );

  // ── write ───────────────────────────────────────────────────────────────────

  server.registerTool(
    'write',
    {
      title: 'Write to Terminal Session',
      description:
        'Send raw text to the session bash stdin. ' +
        'Suitable for keystrokes, control characters, or interactive commands where output capture is not required. ' +
        'For capturing stdout/stderr use the exec tool instead.',
      inputSchema: WriteInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionId, text }: WriteInput) => {
      try {
        log(`tool:write  sessionId=${sessionId} len=${text.length}`);
        const ok = await writeSession(sessionId, text, workspaceRoot);
        if (!ok) {
          logWarn(`tool:write  session ${sessionId} not found`);
          return errorResult(`Session "${sessionId}" not found. Call create_session first.`);
        }
        log(`tool:write  ok sessionId=${sessionId}`);
        return toolResult({ success: true as const });
      } catch (err) {
        logError(`tool:write error: ${String(err)}`);
        return errorResult(`write failed: ${String(err)}`);
      }
    },
  );

  // ── exec ────────────────────────────────────────────────────────────────────

  server.registerTool(
    'exec',
    {
      title: 'Execute Command (Capture Output)',
      description:
        'Run a shell command NON-INTERACTIVELY and capture its full stdout, stderr, and exit code. ' +
        'Spawns a separate transient bash subprocess — does NOT touch the interactive session or the user browser terminal. ' +
        'cwd defaults to the session working directory. ' +
        'env is overlaid on the container environment. ' +
        'timeoutMs defaults to 30 000 ms (max 300 000).',
      inputSchema: ExecInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionId, command, cwd, env, timeoutMs }: ExecInput) => {
      try {
        log(
          `tool:exec  sessionId=${sessionId} timeout=${timeoutMs ?? 30_000} cmd=${command.slice(0, 80)}`,
        );
        const result = await execCommand(sessionId, command, cwd, env, timeoutMs, workspaceRoot);
        log(
          `tool:exec  ok exitCode=${result.exitCode} stdout=${result.stdout.length}B stderr=${result.stderr.length}B`,
        );
        return toolResult(result);
      } catch (err) {
        logError(`tool:exec error: ${String(err)}`);
        return errorResult(`exec failed: ${String(err)}`);
      }
    },
  );

  // ── resize ──────────────────────────────────────────────────────────────────

  server.registerTool(
    'resize',
    {
      title: 'Resize Terminal Session',
      description:
        'Update the stored terminal dimensions (cols × rows) for a session. ' +
        'Call this whenever the UI terminal pane changes size so subsequent output is formatted correctly.',
      inputSchema: ResizeInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionId, cols, rows }: ResizeInput) => {
      try {
        log(`tool:resize sessionId=${sessionId} ${cols}x${rows}`);
        const ok = resizeSession(sessionId, cols, rows);
        if (!ok) {
          logWarn(`tool:resize session ${sessionId} not found`);
          return errorResult(`Session "${sessionId}" not found. Call create_session first.`);
        }
        log(`tool:resize ok sessionId=${sessionId}`);
        return toolResult({ success: true as const });
      } catch (err) {
        logError(`tool:resize error: ${String(err)}`);
        return errorResult(`resize failed: ${String(err)}`);
      }
    },
  );

  // ── prompts ─────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'terminal_workflow',
    {
      title: 'Terminal Workflow',
      description:
        'Step-by-step guide for using the terminal MCP tools to run commands inside the workspace container.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are connected to the crucible-terminal MCP server, which provides shell access inside the workspace container.',
              '',
              'Tool reference:',
              '  create_session(workspaceId, cols?, rows?)',
              '    Get or create the per-workspace bash session.',
              '    Returns { sessionId, cwd, cols, rows, startedAt }.',
              '',
              '  write(sessionId, text)',
              '    Send raw text to the interactive bash stdin.',
              '    Output is not captured; use exec for that.',
              '',
              '  exec(sessionId, command, cwd?, env?, timeoutMs?)',
              '    Run a command NON-interactively and capture output.',
              '    Returns { stdout, stderr, exitCode }.',
              '',
              '  resize(sessionId, cols, rows)',
              '    Update stored terminal dimensions.',
              '',
              'Typical agent workflow:',
              '1. create_session(workspaceId) → note the sessionId.',
              '2. exec(sessionId, "ls -la") → list workspace files.',
              '3. exec(sessionId, "bun install") → install dependencies.',
              '4. exec(sessionId, "bun run build", undefined, undefined, 120000) → build the project.',
              '',
              'Notes:',
              '  - exec spawns a SEPARATE subprocess — it never touches the user browser terminal.',
              '  - write is fire-and-forget; use exec when you need to capture output.',
              '  - The session persists across tool calls but resets on server restart.',
              '  - cwd defaults to /workspace (the workspace root inside the container).',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
