/**
 * Runtime tool execution — HTTP proxy from the control plane to per-workspace
 * MCP services running inside the workspace container.
 *
 * The agent calls `POST /api/runtime` with `{type:'tool_exec', server, tool, args}`.
 * We resolve the captured host port for that workspace's service and forward
 * the request to its REST endpoint defined in `packages/mcp-{chain,compiler}`.
 */

import { getWorkspaceContainerPorts, runtimeServiceBaseUrl } from './runtime-docker';
import { loopbackFetch } from './loopback-fetch';

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

const DEPLOYER_ROUTES: Record<string, RouteSpec> = {
  deploy_local: { method: 'POST', path: () => '/deploy_local', withBody: true },
  simulate_local: { method: 'POST', path: () => '/simulate_local', withBody: true },
  trace: { method: 'POST', path: () => '/trace', withBody: true },
  call: { method: 'POST', path: () => '/call', withBody: true },
};

const WALLET_ROUTES: Record<string, RouteSpec> = {
  list_accounts: { method: 'GET', path: () => '/accounts', withBody: false },
  get_balance: {
    method: 'GET',
    path: (args) => {
      const address = typeof args['address'] === 'string' ? args['address'] : '';
      return address ? `/balance/${encodeURIComponent(address)}` : null;
    },
    withBody: false,
  },
  sign_tx: { method: 'POST', path: () => '/sign_tx', withBody: true },
  send_tx_local: { method: 'POST', path: () => '/send_tx_local', withBody: true },
  switch_account: { method: 'POST', path: () => '/switch_account', withBody: true },
};

const MEMORY_ROUTES: Record<string, RouteSpec> = {
  recall: { method: 'POST', path: () => '/recall', withBody: true },
  remember: { method: 'POST', path: () => '/remember', withBody: true },
  list_patterns: { method: 'GET', path: () => '/patterns', withBody: false },
  provenance: {
    method: 'GET',
    path: (args) => {
      const id = typeof args['id'] === 'string' ? args['id'] : '';
      return id ? `/provenance/${encodeURIComponent(id)}` : null;
    },
    withBody: false,
  },
};

const MESH_ROUTES: Record<string, RouteSpec> = {
  list_peers: { method: 'GET', path: () => '/peers', withBody: false },
  broadcast_help: { method: 'POST', path: () => '/broadcast_help', withBody: true },
  collect_responses: { method: 'POST', path: () => '/collect_responses', withBody: true },
  respond: { method: 'POST', path: () => '/respond', withBody: true },
  verify_peer_patch: { method: 'POST', path: () => '/verify_peer_patch', withBody: true },
};

const TERMINAL_ROUTES: Record<string, RouteSpec> = {
  create_session: { method: 'POST', path: () => '/create_session', withBody: true },
  write: { method: 'POST', path: () => '/write', withBody: true },
  exec: { method: 'POST', path: () => '/exec', withBody: true },
  resize: { method: 'POST', path: () => '/resize', withBody: true },
};

type KnownServer = 'chain' | 'compiler' | 'deployer' | 'wallet' | 'memory' | 'mesh' | 'terminal';

function pickRoute(server: KnownServer, tool: string): RouteSpec | null {
  const tables: Record<KnownServer, Record<string, RouteSpec>> = {
    chain: CHAIN_ROUTES,
    compiler: COMPILER_ROUTES,
    deployer: DEPLOYER_ROUTES,
    wallet: WALLET_ROUTES,
    memory: MEMORY_ROUTES,
    mesh: MESH_ROUTES,
    terminal: TERMINAL_ROUTES,
  };
  return tables[server][tool] ?? null;
}

async function proxyToService(
  server: string,
  port: number,
  spec: RouteSpec,
  args: Record<string, unknown>,
): Promise<ToolExecOutcome> {
  const path = spec.path(args);
  if (!path) {
    return { ok: false, error: `tool requires a non-empty contractName argument` };
  }

  const url = `${runtimeServiceBaseUrl(port)}${path}`;
  const init: RequestInit = {
    method: spec.method,
    headers: spec.withBody
      ? { 'content-type': 'application/json', accept: 'application/json' }
      : { accept: 'application/json' },
    ...(spec.withBody ? { body: JSON.stringify(args) } : {}),
  };

  let res: Response;
  try {
    res = await loopbackFetch(url, init);
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
  const ports = await getWorkspaceContainerPorts(input.workspaceId).catch(() => null);
  if (!ports) {
    return {
      ok: false,
      error: 'workspace runtime container is not available — call open_workspace first',
    };
  }

  const portMap: Record<string, number | null> = {
    chain: ports.chain,
    compiler: ports.compiler,
    deployer: ports.deployer,
    wallet: ports.wallet,
    memory: ports.memory,
    terminal: ports.terminal,
    mesh: ports.mesh,
  };

  const port = portMap[input.server] ?? null;
  if (port === null) {
    return {
      ok: false,
      error: `runtime service '${input.server}' has no published host port — runtime may still be starting`,
    };
  }

  const spec = pickRoute(input.server as KnownServer, input.tool);
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
