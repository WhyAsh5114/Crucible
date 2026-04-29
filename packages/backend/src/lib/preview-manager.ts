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

  window.ethereum = {
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

  // Announce via EIP-6963 so wagmi/viem discover us as "Crucible" instead
  // of falling back to the MetaMask extension (if installed).
  var providerDetail = {
    info: {
      uuid: 'crucible-preview-bridge-v1',
      name: 'Crucible',
      icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text y=%2224%22 font-size=%2224%22>⚗</text></svg>',
      rdns: 'app.crucible.preview',
    },
    provider: window.ethereum,
  };
  function announceProvider() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(providerDetail) }));
  }
  window.addEventListener('eip6963:requestProvider', announceProvider);
  announceProvider();

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
  const previewUrl = `http://localhost:${port}`;

  // Ensure the workspace frontend's dependencies are installed before starting
  // Vite. `writeIfAbsent` only writes package.json — bun install is not run
  // during scaffold, so node_modules may be absent on first launch.
  await new Promise<void>((resolve, reject) => {
    const install = spawn('bun', ['install'], {
      cwd: frontendDir,
      stdio: 'pipe',
    });
    (install as unknown as EventEmitter).on('exit', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`bun install exited with code ${code}`));
    });
    (install as unknown as EventEmitter).on('error', reject);
  });

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
    },
    stdio: 'pipe',
  });

  (vite as unknown as EventEmitter).on('exit', () => {
    previews.delete(workspaceId);
    prisma.workspaceRuntime
      .updateMany({ where: { workspaceId }, data: { previewUrl: null } })
      .catch(() => undefined);
  });

  previews.set(workspaceId, { process: vite, port, previewUrl });

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
