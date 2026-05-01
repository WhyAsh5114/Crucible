/**
 * Loopback fetch wrapper for backend → workspace runtime calls.
 *
 * The control plane reaches in-container MCP services through host ports
 * published by Docker (e.g. `http://127.0.0.1:32768/mcp`). Two interactions
 * make plain `fetch` unreliable on Bun for that hop:
 *
 *  1. Bun retains HTTP/1.1 keep-alive sockets in a per-origin pool.
 *  2. Docker's userland proxy (`docker-proxy`) drops idle connections without
 *     a clean half-close that Bun's pool detects, so the next request can
 *     write onto a dead socket and fail with `"socket connection was closed
 *     unexpectedly"`. The agent's MCP client init and the EIP-1193 RPC proxy
 *     both surface this as 503s in the browser.
 *
 * `loopbackFetch` neutralises both by:
 *  - sending `Connection: close` so each request gets a fresh TCP socket,
 *  - retrying once on the well-known transient socket-close errors that
 *    survive the first defence (e.g. when the mapping itself is mid-restart),
 *    while letting application-level errors (4xx/5xx, AbortError) propagate
 *    without retry.
 *
 * This wrapper is a drop-in replacement for `fetch` and is the only
 * sanctioned way to reach a workspace runtime port from the control plane.
 */

const TRANSIENT_PATTERNS = [
  /socket connection was closed unexpectedly/i,
  /ECONNRESET/i,
  /EPIPE/i,
  /failed to fetch/i,
  /fetch failed/i,
];

function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  const message = err.message;
  if (TRANSIENT_PATTERNS.some((re) => re.test(message))) return true;
  // Bun wraps the underlying socket error as `cause`; check it too.
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && TRANSIENT_PATTERNS.some((re) => re.test(cause.message))) {
    return true;
  }
  return false;
}

function withConnectionClose(init: RequestInit | undefined): RequestInit {
  // Headers can be a Headers instance, a record, or [k,v][]. Normalise to
  // Headers so we don't accidentally drop existing entries.
  const headers = new Headers(init?.headers ?? {});
  headers.set('Connection', 'close');
  return { ...init, headers };
}

export interface LoopbackFetchOptions {
  /** Total attempts (initial + retries). Defaults to 2. Set to 1 to disable retry. */
  attempts?: number;
}

/**
 * Fetch a backend → workspace runtime URL with keep-alive disabled and a
 * one-shot retry on transient socket-close errors.
 *
 * The signature mirrors the global `fetch` so callers can swap it in without
 * other changes.
 */
export async function loopbackFetch(
  input: string | URL | Request,
  init?: RequestInit,
  options: LoopbackFetchOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const finalInit = withConnectionClose(init);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, finalInit);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isTransientFetchError(err)) {
        throw err;
      }
      // Brief backoff so a flapping docker-proxy doesn't get hit twice in <1ms.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}
