/**
 * Vite preview launcher — spawned as a child process per workspace by
 * preview-manager.ts.
 *
 * Uses Vite's programmatic createServer() API so the Crucible bridge plugin
 * is injected entirely in-memory. No files are written into the user's
 * workspace; no index.html is patched.
 *
 * Vite automatically loads the workspace's own vite.config.ts (from cwd,
 * which preview-manager.ts sets to the workspace's frontend/ directory).
 * The bridge plugin is appended on top of whatever the workspace config
 * defines — user config is fully preserved.
 *
 * Environment variables (set by preview-manager.ts):
 *   CRUCIBLE_BRIDGE_SCRIPT  — the preview-bridge.js IIFE content (in-memory)
 *   CRUCIBLE_VITE_PORT      — port for the Vite dev server
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Dynamic import so Bun resolves vite from the workspace's own node_modules
// (cwd = frontendDir set by preview-manager.ts), not from the launcher's own
// file location (packages/backend/src/lib/) which has no vite dependency.
const { createServer } = await import(
  pathToFileURL(path.join(process.cwd(), 'node_modules/vite/dist/node/index.js')).href
);

const bridgeScript = process.env['CRUCIBLE_BRIDGE_SCRIPT'] ?? '';
const port = Number(process.env['CRUCIBLE_VITE_PORT'] ?? '5174');

/** Crucible bridge plugin — serves the EIP-1193 bridge script from memory
 *  and injects the <script> tag into every HTML response via transformIndexHtml.
 *  Nothing is written to disk inside the workspace. */
const crucibleBridgePlugin = {
  name: 'crucible-preview-bridge',

  configureServer(server) {
    server.middlewares.use('/__crucible/preview-bridge.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(bridgeScript);
    });
  },

  transformIndexHtml(html) {
    // Idempotent — skip if already injected (e.g. user added it manually).
    if (html.includes('/__crucible/preview-bridge.js')) return html;
    return html.replace(
      /<head>/i,
      '<head>\n    <script src="/__crucible/preview-bridge.js"></script>',
    );
  },
};

const server = await createServer({
  // root defaults to process.cwd() — preview-manager.ts sets cwd to the
  // workspace's frontend/ dir, so Vite picks up vite.config.ts from there.
  server: { port, host: '127.0.0.1', strictPort: true },
  plugins: [crucibleBridgePlugin],
});

await server.listen();
server.printUrls();
