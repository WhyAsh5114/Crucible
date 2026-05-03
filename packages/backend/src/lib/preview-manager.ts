/**
 * Per-workspace Vite preview supervisor.
 *
 * Starts a `vite dev` process for the workspace's `frontend/` directory,
 * assigns a host port, and persists `previewUrl` to the DB so the frontend
 * shell can iframe it.
 *
 * One Vite process per workspace. Subsequent calls to `startPreview` while
 * a process is already running return the existing URL.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  PREVIEW_BRIDGE_PROTOCOL,
  PREVIEW_BRIDGE_VERSION,
  ALLOWED_RPC_METHODS,
  type PreviewState,
  type PreviewPhase,
} from '@crucible/types';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PreviewEntry = {
  process: ChildProcess;
  port: number;
  previewUrl: string;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const previews = new Map<string, PreviewEntry>();

/**
 * Live boot status per workspace, surfaced to the frontend via the workspace
 * GET response so the preview pane can render real progress (currently
 * installing dependencies, starting Vite, …) instead of a generic "DEGRADED"
 * banner. Reset to `idle` when the supervisor first sees the workspace.
 */
const previewStates = new Map<string, PreviewState>();
const LOG_TAIL_LIMIT = 40;

function makeIdleState(): PreviewState {
  return { phase: 'idle', logTail: [], updatedAt: Date.now() };
}

function setPhase(workspaceId: string, phase: PreviewPhase): void {
  const current = previewStates.get(workspaceId) ?? makeIdleState();
  previewStates.set(workspaceId, {
    phase,
    logTail: current.logTail,
    updatedAt: Date.now(),
  });
}

/**
 * Append log lines to the workspace's preview log tail, keeping only the most
 * recent `LOG_TAIL_LIMIT` lines so the GET workspace response stays small.
 * Splits on newlines and drops empty lines.
 */
function appendLogTail(workspaceId: string, chunk: string): void {
  if (!chunk) return;
  const current = previewStates.get(workspaceId) ?? makeIdleState();
  const incoming = chunk
    .split(/\r?\n/u)
    // bun/vite stdout includes ANSI color codes; strip them so the log tail
    // renders cleanly in the preview pane.
    // eslint-disable-next-line no-control-regex
    .map((line) => line.replace(/\[[0-9;]*m/gu, '').trimEnd())
    .filter((line) => line.length > 0);
  if (incoming.length === 0) return;
  const next = [...current.logTail, ...incoming];
  const trimmed = next.length > LOG_TAIL_LIMIT ? next.slice(next.length - LOG_TAIL_LIMIT) : next;
  previewStates.set(workspaceId, {
    phase: current.phase,
    logTail: trimmed,
    updatedAt: Date.now(),
  });
}

/**
 * Returns the current preview boot state for a workspace.
 * Returns the `idle` default when the supervisor has never run for it.
 */
export function getPreviewState(workspaceId: string): PreviewState {
  return previewStates.get(workspaceId) ?? makeIdleState();
}

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    (server as unknown as EventEmitter).on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve((addr as { port: number }).port));
    });
  });
}

// ---------------------------------------------------------------------------
// Bridge injection
// ---------------------------------------------------------------------------

const LAUNCHER_PATH = fileURLToPath(new URL('./vite-preview-launcher.mjs', import.meta.url));

/**
 * Generates the preview-bridge.js content as a plain IIFE (no bundler,
 * no imports). Implements the `crucible-preview-bridge` v1 postMessage
 * protocol defined in @crucible/types/src/preview.ts.
 *
 * The content is generated at runtime so it always reflects the exact
 * ALLOWED_RPC_METHODS list from the types package without requiring a
 * separate build step.
 */
export function buildBridgeScript(): string {
  const allowedJson = JSON.stringify(ALLOWED_RPC_METHODS);
  return `\
// preview-bridge.js — injected by Crucible into the workspace preview iframe.
// Implements the ${PREVIEW_BRIDGE_PROTOCOL} v${PREVIEW_BRIDGE_VERSION} postMessage protocol.
(function () {
  var PROTOCOL = ${JSON.stringify(PREVIEW_BRIDGE_PROTOCOL)};
  var VERSION = ${PREVIEW_BRIDGE_VERSION};
  var ALLOWED = new Set(${allowedJson});

  var nextId = 1;
  var pending = new Map();
  var listeners = new Map();

  function genId() {
    return String(nextId++);
  }

  function sendToShell(msg) {
    // Phase 5 TODO: replace '*' with the exact shell origin once the
    // subdomain preview model (preview.{workspaceId}.crucible.localhost)
    // is implemented. See docs/ARCHITECTURE.md — "Dev Topology (Portless)".
    window.parent.postMessage(msg, '*');
  }

  function emitEvent(name, payload) {
    var cbs = listeners.get(name);
    if (cbs) cbs.forEach(function (cb) { cb(payload); });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.protocol !== PROTOCOL || d.version !== VERSION) return;
    if (d.direction !== 'shell-to-preview') return;

    if (d.type === 'hello_ack') {
      emitEvent('connect', { chainId: d.chainId });
      emitEvent('chainChanged', d.chainId);
    } else if (d.type === 'rpc_response') {
      var p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.outcome.ok) {
        p.resolve(d.outcome.result);
      } else {
        var err = new Error(d.outcome.message);
        err.code = d.outcome.code;
        p.reject(err);
      }
    } else if (d.type === 'event') {
      emitEvent(d.event, d.payload);
    }
  });

  var crucibleProvider = {
    isMetaMask: false,
    isCrucible: true,
    request: function (req) {
      var method = req.method;
      var params = req.params || [];
      if (!ALLOWED.has(method)) {
        var e = new Error('Method ' + method + ' not supported by Crucible bridge');
        e.code = 4200;
        return Promise.reject(e);
      }
      return new Promise(function (resolve, reject) {
        var id = genId();
        pending.set(id, { resolve: resolve, reject: reject });
        sendToShell({
          protocol: PROTOCOL,
          version: VERSION,
          id: id,
          direction: 'preview-to-shell',
          type: 'rpc_request',
          method: method,
          params: params,
        });
      });
    },
    on: function (event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
    },
    removeListener: function (event, callback) {
      var cbs = listeners.get(event);
      if (cbs) cbs.delete(callback);
    },
  };

  // Lock window.ethereum so MetaMask (or any other wallet extension) can't
  // overwrite our bridge by injecting after we run. Without this, the dApp
  // ends up talking to MetaMask on whatever public chain MetaMask happens to
  // be on, while the Crucible wallet pane shows "no account connected"
  // because nothing is going through /rpc anymore.
  try {
    Object.defineProperty(window, 'ethereum', {
      value: crucibleProvider,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch (_e) {
    // Some environment already locked it (rare). Fall back to direct assign;
    // EIP-6963 announce below still lets the dApp pick Crucible explicitly.
    window.ethereum = crucibleProvider;
  }

  // Announce via EIP-6963 so wagmi/viem discover us as "Crucible". MetaMask
  // (if installed) also announces itself; we can't suppress its event but we
  // can re-announce on a short cadence so wagmi's provider discovery list
  // consistently includes Crucible — and we re-announce whenever the dApp
  // re-emits eip6963:requestProvider. Without the periodic re-announce,
  // dApps that mount their connect modal after our initial dispatch see only
  // MetaMask in the list and route txs there, leaving Crucible's wallet
  // pane empty.
  var providerDetail = {
    info: {
      uuid: 'crucible-preview-bridge-v1',
      name: 'Crucible',
      icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text y=%2224%22 font-size=%2224%22>⚗</text></svg>',
      rdns: 'app.crucible.preview',
    },
    provider: crucibleProvider,
  };
  function announceProvider() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(providerDetail) }));
  }
  window.addEventListener('eip6963:requestProvider', announceProvider);
  announceProvider();
  // Re-announce shortly after to catch dApps that mount their connect modal
  // after the initial dispatch (common with framework-driven UIs).
  setTimeout(announceProvider, 100);
  setTimeout(announceProvider, 500);
  setTimeout(announceProvider, 1500);

  // Kick off the handshake once the document is ready.
  function sendHello() {
    sendToShell({
      protocol: PROTOCOL,
      version: VERSION,
      id: genId(),
      direction: 'preview-to-shell',
      type: 'hello',
      origin: window.location.origin,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendHello);
  } else {
    sendHello();
  }
})();
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the Vite dev server for the workspace's `frontend/` directory.
 * Returns the preview URL. No-ops if already running.
 */
export async function startPreview(workspaceId: string, workspaceDir: string): Promise<string> {
  const existing = previews.get(workspaceId);
  if (existing) return existing.previewUrl;

  const frontendDir = path.join(workspaceDir, 'frontend');
  const port = await getFreePort();

  // When CRUCIBLE_APP_URL is set (production), serve the preview through the
  // backend's path-based proxy at /preview/:workspaceId so the browser can
  // reach it from the real domain instead of a raw localhost port.
  const appUrl = process.env['CRUCIBLE_APP_URL'];
  const viteBase = appUrl ? `/preview/${workspaceId}/` : '/';
  const previewUrl = appUrl ? `${appUrl}/preview/${workspaceId}` : `http://localhost:${port}`;

  // Ensure the workspace frontend's dependencies are installed before starting
  // Vite. `writeIfAbsent` only writes package.json — bun install is not run
  // during scaffold, so node_modules may be absent on first launch. We
  // capture stdout + stderr both so install failures bubble up with the
  // actual reason and so the frontend can render live progress (the install
  // is the slowest leg of preview boot, ~30–60s cold).
  //
  // Cache shortcut: if `node_modules/.crucible-installed` is present we
  // assume the workspace is already prepared and skip the install entirely.
  const { existsSync } = await import('node:fs');
  const { writeFile: writeFileFs } = await import('node:fs/promises');
  const installedMarker = path.join(frontendDir, 'node_modules', '.crucible-installed');
  const alreadyInstalled = existsSync(installedMarker);

  if (!alreadyInstalled) {
    setPhase(workspaceId, 'installing');
    appendLogTail(workspaceId, `Installing dependencies in ${frontendDir}…`);
    try {
      await new Promise<void>((resolve, reject) => {
        const install = spawn('bun', ['install'], {
          cwd: frontendDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        install.stdout?.on('data', (chunk: Buffer) => {
          appendLogTail(workspaceId, chunk.toString());
        });
        install.stderr?.on('data', (chunk: Buffer) => {
          appendLogTail(workspaceId, chunk.toString());
        });
        (install as unknown as EventEmitter).on('exit', (code: number | null) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`bun install exited with code ${code}`));
        });
        (install as unknown as EventEmitter).on('error', reject);
      });
    } catch (err) {
      setPhase(workspaceId, 'failed');
      appendLogTail(
        workspaceId,
        `Install failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    // Drop the marker so we skip the install on subsequent boots.
    await writeFileFs(installedMarker, `${Date.now()}\n`, 'utf8').catch(() => undefined);
  }

  setPhase(workspaceId, 'starting');
  appendLogTail(workspaceId, `Starting Vite dev server on port ${port}…`);

  // Spawn the launcher script which uses Vite's programmatic createServer() API.
  // The bridge plugin is injected in-memory — no files are written into the
  // workspace. Vite reads vite.config.ts from frontendDir (process.cwd) and
  // merges the bridge plugin on top of whatever the workspace config defines.
  const vite = spawn('bun', ['run', LAUNCHER_PATH], {
    cwd: frontendDir,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      CRUCIBLE_BRIDGE_SCRIPT: buildBridgeScript(),
      CRUCIBLE_VITE_PORT: String(port),
      CRUCIBLE_VITE_BASE: viteBase,
    },
    stdio: 'pipe',
  });

  // Forward Vite stdout/stderr into the log tail so failures during dev
  // server boot are visible in the preview pane.
  vite.stdout?.on('data', (chunk: Buffer) => appendLogTail(workspaceId, chunk.toString()));
  vite.stderr?.on('data', (chunk: Buffer) => appendLogTail(workspaceId, chunk.toString()));

  (vite as unknown as EventEmitter).on('exit', (code: number | null) => {
    previews.delete(workspaceId);
    setPhase(workspaceId, code === 0 || code === null ? 'idle' : 'failed');
    appendLogTail(workspaceId, `Vite exited with code ${code ?? 'null'}.`);
    prisma.workspaceRuntime
      .updateMany({ where: { workspaceId }, data: { previewUrl: null } })
      .catch(() => undefined);
  });

  previews.set(workspaceId, { process: vite, port, previewUrl });
  setPhase(workspaceId, 'ready');

  await prisma.workspaceRuntime
    .updateMany({ where: { workspaceId }, data: { previewUrl } })
    .catch((err) => {
      console.warn(`[preview ${workspaceId}] failed to persist previewUrl:`, err);
    });

  return previewUrl;
}

/**
 * Stop the preview server for a workspace. No-ops if not running.
 */
export function stopPreview(workspaceId: string): void {
  const entry = previews.get(workspaceId);
  if (!entry) return;
  previews.delete(workspaceId);
  entry.process.kill('SIGTERM');
}

export function getPreviewUrl(workspaceId: string): string | null {
  return previews.get(workspaceId)?.previewUrl ?? null;
}

export function getPreviewPort(workspaceId: string): number | null {
  return previews.get(workspaceId)?.port ?? null;
}
