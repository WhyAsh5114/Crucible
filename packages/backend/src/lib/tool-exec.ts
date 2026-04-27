/**
 * Runtime tool execution — HTTP proxy from the control plane to per-workspace
 * MCP services running inside the workspace container.
 *
 * The agent calls `POST /api/runtime` with `{type:'tool_exec', server, tool, args}`.
 * We resolve the captured host port for that workspace's service and forward
 * the request to its REST endpoint defined in `packages/mcp-{chain,compiler}`.
 *
 * Only `chain` and `compiler` are wired today (per Phase 0/1 issue #1 scope).
 * Other servers return a clean unsupported outcome.
 */

import { getWorkspaceContainerPorts, runtimeServiceBaseUrl } from './runtime-docker';

type ToolExecInput = {
  tool: string;
  args: unknown;
  workspaceId: string;
  server: 'chain' | 'compiler' | 'deployer' | 'wallet' | 'terminal' | 'memory' | 'mesh';
};

type ToolExecOutcome =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error: string;
    };

type RouteSpec = {
  method: 'GET' | 'POST';
  /**
   * Resolve the route path. May reference `args` to interpolate path params
   * (e.g. `/abi/{contractName}`). Returns null if required args are missing.
   */
  path: (args: Record<string, unknown>) => string | null;
  /**
   * Whether to send `args` as the JSON body. Path-only tools omit the body.
   */
  withBody: boolean;
};

const CHAIN_ROUTES: Record<string, RouteSpec> = {
  start_node: { method: 'POST', path: () => '/start_node', withBody: true },
  get_state: { method: 'GET', path: () => '/state', withBody: false },
  snapshot: { method: 'POST', path: () => '/snapshot', withBody: false },
  revert: { method: 'POST', path: () => '/revert', withBody: true },
  mine: { method: 'POST', path: () => '/mine', withBody: true },
  fork: { method: 'POST', path: () => '/fork', withBody: true },
};

const COMPILER_ROUTES: Record<string, RouteSpec> = {
  compile: { method: 'POST', path: () => '/compile', withBody: true },
  list_contracts: { method: 'GET', path: () => '/contracts', withBody: false },
  get_abi: {
    method: 'GET',
    path: (args) => {
      const name = typeof args['contractName'] === 'string' ? args['contractName'] : '';
      return name ? `/abi/${encodeURIComponent(name)}` : null;
    },
    withBody: false,
  },
  get_bytecode: {
    method: 'GET',
    path: (args) => {
      const name = typeof args['contractName'] === 'string' ? args['contractName'] : '';
      return name ? `/bytecode/${encodeURIComponent(name)}` : null;
    },
    withBody: false,
  },
};

function pickRoute(server: 'chain' | 'compiler', tool: string): RouteSpec | null {
  const table = server === 'chain' ? CHAIN_ROUTES : COMPILER_ROUTES;
  return table[tool] ?? null;
}

async function proxyToService(
  server: 'chain' | 'compiler',
  port: number,
  spec: RouteSpec,
  args: Record<string, unknown>,
): Promise<ToolExecOutcome> {
  const path = spec.path(args);
  if (!path) {
    return { ok: false, error: `tool requires a non-empty contractName argument` };
  }

  const url = `${runtimeServiceBaseUrl(server, port)}${path}`;
  const init: RequestInit = {
    method: spec.method,
    headers: spec.withBody
      ? { 'content-type': 'application/json', accept: 'application/json' }
      : { accept: 'application/json' },
    ...(spec.withBody ? { body: JSON.stringify(args) } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    return { ok: false, error: `runtime service '${server}' unreachable: ${message}` };
  }

  // Both MCP servers return JSON for every status code. Try to surface the
  // service-provided error message rather than a generic HTTP error.
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      error: `runtime service '${server}' returned non-JSON (status ${res.status})`,
    };
  }

  if (!res.ok) {
    const errMessage =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `service responded with ${res.status}`;
    return { ok: false, error: errMessage };
  }

  return { ok: true, result: payload };
}

export async function executeRuntimeTool(input: ToolExecInput): Promise<ToolExecOutcome> {
  if (input.server !== 'chain' && input.server !== 'compiler') {
    return {
      ok: false,
      error: `tool_exec server '${input.server}' is not implemented yet`,
    };
  }

  const ports = await getWorkspaceContainerPorts(input.workspaceId).catch(() => null);
  if (!ports) {
    return {
      ok: false,
      error: 'workspace runtime container is not available — call open_workspace first',
    };
  }

  const port = input.server === 'chain' ? ports.chain : ports.compiler;
  if (port === null) {
    return {
      ok: false,
      error: `runtime service '${input.server}' has no published host port — runtime may still be starting`,
    };
  }

  const spec = pickRoute(input.server, input.tool);
  if (!spec) {
    return {
      ok: false,
      error: `tool '${input.tool}' is not implemented for server '${input.server}'`,
    };
  }

  const args =
    typeof input.args === 'object' && input.args !== null
      ? (input.args as Record<string, unknown>)
      : {};

  return proxyToService(input.server, port, spec, args);
}
