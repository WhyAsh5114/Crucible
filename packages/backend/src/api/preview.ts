import { Hono } from 'hono';
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

previewApi.all('/preview/:workspaceId/*', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const port = getPreviewPort(workspaceId);

  if (port === null) {
    return c.text('Preview not running for this workspace', 502);
  }

  const url = new URL(c.req.url);
  const targetUrl = `http://127.0.0.1:${port}${url.pathname}${url.search}`;

  // Override the Host header so Vite's allowedHosts check passes.
  // The original Host is the public domain (e.g. crucible.example.com);
  // Vite only trusts localhost/127.0.0.1 by default.
  const forwardHeaders = new Headers(c.req.raw.headers);
  forwardHeaders.set('host', `127.0.0.1:${port}`);
  // Remove hop-by-hop headers that shouldn't be forwarded.
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

  // Strip hop-by-hop response headers before forwarding.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('connection');
  responseHeaders.delete('transfer-encoding');

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
});

export { previewApi };
