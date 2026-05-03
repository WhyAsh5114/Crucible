import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import { getPreviewPort } from '../lib/preview-manager';

/**
 * Path-based preview proxy.
 *
 * In production (CRUCIBLE_APP_URL set), each workspace's Vite dev server is
 * not directly reachable from the browser because it runs on a loopback port.
 * This router forwards /preview/:workspaceId/* requests to the correct Vite
 * process so the browser can load the preview iframe from the real domain.
 *
 * Vite is started with base=/preview/:workspaceId/ so all asset URLs include
 * the same prefix and the proxy can forward the full path unchanged.
 *
 * No auth required — the preview is a Vite dev server for the workspace's
 * generated frontend code, not a privileged endpoint.
 */
const previewApi = new Hono();

// Redirect the bare workspace path to the base-path-suffixed version.
// Without the trailing slash Vite's base-relative assets would resolve wrong.
previewApi.get('/preview/:workspaceId', (c) => {
  const workspaceId = c.req.param('workspaceId');
  return c.redirect(`/preview/${workspaceId}/`, 301);
});

// WebSocket proxy for Vite HMR.
// Vite's client derives the WS URL from location.hostname + the configured base
// (e.g. wss://crucible.example.com/preview/<id>/?token=…). Caddy forwards the
// upgrade to port 3000; we proxy it down to the per-workspace Vite port.
// This route MUST be registered before the HTTP all() handler because both
// share the same path pattern — upgradeWebSocket falls through on plain HTTP.
previewApi.get(
  '/preview/:workspaceId/*',
  upgradeWebSocket((c) => {
    const workspaceId = c.req.param('workspaceId') ?? '';
    const port = getPreviewPort(workspaceId);

    if (port === null) {
      return {
        onOpen(_evt, ws) {
          ws.close(1011, 'preview not running');
        },
      };
    }

    const url = new URL(c.req.url);
    const targetUrl = `ws://127.0.0.1:${port}${url.pathname}${url.search}`;
    const subprotocol = c.req.header('sec-websocket-protocol');

    let viteSocket: WebSocket | null = null;
    const queue: Array<string | ArrayBuffer> = [];

    return {
      onOpen(_evt, ws) {
        viteSocket = new WebSocket(
          targetUrl,
          subprotocol ? subprotocol.split(',').map((s) => s.trim()) : 'vite-hmr',
        );
        viteSocket.binaryType = 'arraybuffer';

        viteSocket.onopen = () => {
          for (const msg of queue) viteSocket!.send(msg);
          queue.length = 0;
        };

        viteSocket.onmessage = (e) => {
          ws.send(e.data as string);
        };

        viteSocket.onclose = (e) => {
          ws.close(e.code, e.reason || undefined);
        };

        viteSocket.onerror = () => {
          ws.close(1011, 'upstream error');
        };
      },

      onMessage(evt, _ws) {
        const data = evt.data as string | ArrayBuffer;
        if (viteSocket?.readyState === WebSocket.OPEN) {
          viteSocket.send(data);
        } else {
          queue.push(data);
        }
      },

      onClose() {
        viteSocket?.close();
        queue.length = 0;
      },

      onError() {
        viteSocket?.close();
        queue.length = 0;
      },
    };
  }),
);

previewApi.all('/preview/:workspaceId/*', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const port = getPreviewPort(workspaceId);

  if (port === null) {
    return c.text('Preview not running for this workspace', 502);
  }

  const url = new URL(c.req.url);
  const targetUrl = `http://127.0.0.1:${port}${url.pathname}${url.search}`;

  // Override the Host header so Vite's allowedHosts check passes.
  const forwardHeaders = new Headers(c.req.raw.headers);
  forwardHeaders.set('host', `127.0.0.1:${port}`);
  forwardHeaders.delete('connection');

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: c.req.method,
      headers: forwardHeaders,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
    });
  } catch {
    return c.text('Preview unavailable — Vite server not ready', 502);
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('connection');
  responseHeaders.delete('transfer-encoding');

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
});

export { previewApi };
