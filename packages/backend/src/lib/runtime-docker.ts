import path from 'node:path';
import Docker from 'dockerode';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

export type DockerCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type WorkspaceContainerState = 'missing' | 'running' | 'stopped';

// --- Config ---

const docker = process.env['DOCKER_SOCKET_PATH']
  ? new Docker({ socketPath: process.env['DOCKER_SOCKET_PATH'] })
  : new Docker();

const WORKSPACES_BIND_ROOT = process.env['CRUCIBLE_RUNTIME_BIND_ROOT'];
const MOUNT_MODE = process.env['CRUCIBLE_RUNTIME_MOUNT_MODE'] ?? 'bind';
const RUNTIME_IMAGE = process.env['CRUCIBLE_RUNTIME_IMAGE'] ?? 'crucible-runtime:latest';
const DOCKER_RETRY_COUNT = Number(process.env['CRUCIBLE_DOCKER_RETRY_COUNT'] ?? '2');
const DOCKER_TIMEOUT_MS = Number(process.env['CRUCIBLE_DOCKER_TIMEOUT_MS'] ?? '15000');
const VOLUME_MOUNT_ROOT = process.env['CRUCIBLE_RUNTIME_VOLUME_ROOT'] ?? '/workspace-root';
const WORKSPACES_VOLUME = process.env['CRUCIBLE_WORKSPACES_VOLUME'] ?? 'crucible-workspaces-data';

// Loopback ports the in-container MCP services bind to. Host-side ports are
// assigned dynamically by Docker and discovered after the container starts.
const CONTAINER_CHAIN_PORT = 3100;
const CONTAINER_COMPILER_PORT = 3101;
const CONTAINER_DEPLOYER_PORT = 3102;
const CONTAINER_WALLET_PORT = 3103;
const CONTAINER_MEMORY_PORT = 3104;
const CONTAINER_TERMINAL_PORT = 3106;
const CONTAINER_DEVTOOLS_PORT = 3107;

const READINESS_TIMEOUT_MS = Number(process.env['CRUCIBLE_RUNTIME_READY_TIMEOUT_MS'] ?? '60000');
const READINESS_INTERVAL_MS = Number(process.env['CRUCIBLE_RUNTIME_READY_INTERVAL_MS'] ?? '500');
const RUNTIME_HOST = process.env['CRUCIBLE_RUNTIME_HOST'] ?? '127.0.0.1';

// --- Error helpers ---

function isDockerNotFound(error: unknown): boolean {
  return isDockerStatusCode(error, 404);
}

function isDockerConflict(error: unknown): boolean {
  return isDockerStatusCode(error, 409);
}

function isDockerStatusCode(error: unknown, code: number): boolean {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === code
  );
}

function isTransientError(error: unknown): boolean {
  // Don't retry on well-known non-transient Docker status codes
  return (
    !isDockerNotFound(error) &&
    !isDockerConflict(error) &&
    !isDockerStatusCode(error, 401) &&
    !isDockerStatusCode(error, 403)
  );
}

// --- Async utilities ---

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${DOCKER_TIMEOUT_MS}ms`));
    }, DOCKER_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = DOCKER_RETRY_COUNT,
): Promise<T> {
  let lastError: unknown;
  const maxAttempts = Math.max(1, attempts);

  for (let index = 0; index < maxAttempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

// --- Docker availability (checked once, cached) ---

let dockerAvailablePromise: Promise<void> | undefined;

function assertDockerAvailable(): Promise<void> {
  dockerAvailablePromise ??= withRetry(() =>
    withTimeout(docker.ping() as Promise<unknown>, 'Docker ping'),
  ).then(() => undefined);

  return dockerAvailablePromise;
}

// --- Naming and path helpers ---

function sanitizedWorkspaceToken(workspaceId: string): string {
  const normalized = workspaceId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
  return normalized.replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace';
}

function runtimeContainerName(workspaceId: string): string {
  return `crucible-ws-${sanitizedWorkspaceToken(workspaceId)}`;
}

function runtimeWorkspaceDir(workspaceId: string): string {
  return MOUNT_MODE === 'volume' ? `${VOLUME_MOUNT_ROOT}/${workspaceId}` : '/workspace';
}

function workspaceBind(workspaceId: string, hostWorkspacePath: string): string {
  if (MOUNT_MODE === 'volume') {
    return `${WORKSPACES_VOLUME}:${VOLUME_MOUNT_ROOT}`;
  }

  const bindSource = WORKSPACES_BIND_ROOT
    ? path.join(WORKSPACES_BIND_ROOT, workspaceId)
    : hostWorkspacePath;

  // Docker treats a non-absolute bind source as a named-volume name, which
  // silently disconnects the agent's file writes from the workspace container.
  // Refuse to create such a container — surface the misconfiguration loudly.
  if (!path.isAbsolute(bindSource)) {
    throw new Error(
      `workspace bind source must be an absolute path (got "${bindSource}"). ` +
        `Set CRUCIBLE_WORKSPACES_ROOT or CRUCIBLE_RUNTIME_BIND_ROOT to an absolute path.`,
    );
  }

  return `${bindSource}:/workspace`;
}

// --- Container inspection helpers ---

async function getContainerInspect(
  containerName: string,
): Promise<Docker.ContainerInspectInfo | null> {
  try {
    return await withRetry(() =>
      withTimeout(docker.getContainer(containerName).inspect(), `Inspect ${containerName}`),
    );
  } catch (error) {
    if (isDockerNotFound(error)) return null;
    throw error;
  }
}

// --- Image and volume setup ---

async function ensureRuntimeImageAvailable(): Promise<void> {
  try {
    await withTimeout(docker.getImage(RUNTIME_IMAGE).inspect(), 'Inspect runtime image');
    return;
  } catch (error) {
    if (!isDockerNotFound(error)) throw error;
  }

  try {
    const stream = await withTimeout(docker.pull(RUNTIME_IMAGE), 'Pull runtime image');

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (error: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
      'Wait for image pull',
    );
  } catch (error) {
    // Locally built images can't be pulled. Surface a clear, actionable
    // error pointing to the build script instead of an opaque modem failure.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Runtime image '${RUNTIME_IMAGE}' is not present locally and could not be pulled (${message}). ` +
        `If this is the default Crucible runtime image, build it first: ` +
        `bun run --cwd packages/backend runtime:build`,
      { cause: error },
    );
  }
}

async function ensureWorkspaceVolumeExists(): Promise<void> {
  if (MOUNT_MODE !== 'volume') return;

  try {
    await withTimeout(docker.getVolume(WORKSPACES_VOLUME).inspect(), 'Inspect workspace volume');
  } catch (error) {
    if (!isDockerNotFound(error)) throw error;
    await withTimeout(docker.createVolume({ Name: WORKSPACES_VOLUME }), 'Create workspace volume');
  }
}

// --- Public API ---

export function getRuntimeContainerName(workspaceId: string): string {
  return runtimeContainerName(workspaceId);
}

export async function getWorkspaceContainerState(
  workspaceId: string,
): Promise<WorkspaceContainerState> {
  await assertDockerAvailable();
  const containerName = runtimeContainerName(workspaceId);
  const inspect = await getContainerInspect(containerName);

  if (!inspect) return 'missing';
  return inspect.State?.Running ? 'running' : 'stopped';
}

export async function execInWorkspaceContainer(
  workspaceId: string,
  cmd: string[],
): Promise<DockerCommandResult> {
  const containerName = runtimeContainerName(workspaceId);
  const workspaceDir = runtimeWorkspaceDir(workspaceId);
  const state = await getWorkspaceContainerState(workspaceId);

  if (state === 'missing') {
    throw new Error(`Runtime container not found: ${containerName}`);
  }
  if (state !== 'running') {
    throw new Error(`Runtime container is not running: ${containerName}`);
  }

  return withRetry(async () => {
    const container = docker.getContainer(containerName);

    const exec = await withTimeout(
      container.exec({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd,
        WorkingDir: workspaceDir,
        Tty: false,
      }),
      `Create exec in ${containerName}`,
    );

    const stream = await withTimeout(
      exec.start({ hijack: false, stdin: false }),
      `Start exec in ${containerName}`,
    );

    let stdout = '';
    let stderr = '';

    const stdoutWritable = new Writable({
      write(chunk, _encoding, callback) {
        stdout += (chunk as Buffer).toString('utf8');
        callback();
      },
    });

    const stderrWritable = new Writable({
      write(chunk, _encoding, callback) {
        stderr += (chunk as Buffer).toString('utf8');
        callback();
      },
    });

    docker.modem.demuxStream(stream, stdoutWritable, stderrWritable);
    await withTimeout(finished(stream), `Read exec output from ${containerName}`);

    const result = await withTimeout(exec.inspect(), `Inspect exec in ${containerName}`);

    return {
      code: result.ExitCode ?? 1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  });
}

export async function stopWorkspaceContainer(workspaceId: string): Promise<void> {
  const containerName = runtimeContainerName(workspaceId);
  const state = await getWorkspaceContainerState(workspaceId);

  if (state !== 'running') return;

  await withRetry(() =>
    withTimeout(docker.getContainer(containerName).stop({ t: 10 }), `Stop ${containerName}`),
  );
}

export type WorkspaceRuntimePorts = {
  chain: number | null;
  compiler: number | null;
  deployer: number | null;
  wallet: number | null;
  memory: number | null;
  terminal: number | null;
  devtools: number | null;
};

export type EnsureWorkspaceContainerResult = {
  containerName: string;
  startedAtMs: number;
  ports: WorkspaceRuntimePorts;
  ready: boolean;
};

function extractHostPort(
  inspect: Docker.ContainerInspectInfo,
  containerPort: number,
): number | null {
  const bindings = inspect.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
  const first = bindings?.[0]?.HostPort;
  if (!first) return null;
  const parsed = Number.parseInt(first, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function probeOnce(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    try {
      // Any HTTP response — including 4xx/5xx — proves the service is
      // listening. The chain server, for example, returns 500 from /state
      // before `start_node` is called, but it is still "up". Only network
      // errors (ECONNREFUSED, abort, etc.) count as not-ready.
      await fetch(url, { signal: controller.signal });
      return true;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

/**
 * Wait until all in-container MCP services answer HTTP. Returns true when
 * all are reachable; false on timeout. The caller decides whether a partial
 * boot warrants `degraded` or `crashed`.
 */
export async function waitForRuntimeReady(ports: WorkspaceRuntimePorts): Promise<boolean> {
  if (ports.chain === null || ports.compiler === null) return false;

  // Build probe list for all services that have allocated ports.
  const probeUrls: string[] = [];
  if (ports.chain !== null) probeUrls.push(`http://${RUNTIME_HOST}:${ports.chain}/state`);
  if (ports.compiler !== null) probeUrls.push(`http://${RUNTIME_HOST}:${ports.compiler}/contracts`);
  if (ports.deployer !== null) probeUrls.push(`http://${RUNTIME_HOST}:${ports.deployer}/mcp`);
  if (ports.wallet !== null) probeUrls.push(`http://${RUNTIME_HOST}:${ports.wallet}/mcp`);
  if (ports.terminal !== null) probeUrls.push(`http://${RUNTIME_HOST}:${ports.terminal}/mcp`);

  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const results = await Promise.all(probeUrls.map((url) => probeOnce(url)));
    if (results.every(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS));
  }

  return false;
}

// Build the Env array for a workspace container. Static port assignments and
// workspace identity are always included. 0G credentials are forwarded from
// the host process so mcp-memory and mcp-deployer can use 0G Storage / 0G
// Chain without the operator having to build a custom image.
function buildContainerEnv(workspaceId: string, workspaceDir: string): string[] {
  const env: string[] = [
    `WORKSPACE_ID=${workspaceId}`,
    `CHAIN_MCP_PORT=${CONTAINER_CHAIN_PORT}`,
    `COMPILER_MCP_PORT=${CONTAINER_COMPILER_PORT}`,
    `DEPLOYER_MCP_PORT=${CONTAINER_DEPLOYER_PORT}`,
    `WALLET_MCP_PORT=${CONTAINER_WALLET_PORT}`,
    `MEMORY_MCP_PORT=${CONTAINER_MEMORY_PORT}`,
    `TERMINAL_MCP_PORT=${CONTAINER_TERMINAL_PORT}`,
    `DEVTOOLS_MCP_PORT=${CONTAINER_DEVTOOLS_PORT}`,
    `WORKSPACE_ROOT=${workspaceDir}`,
  ];

  // Forward 0G credentials when set so in-container services can use 0G
  // Storage (mcp-memory) and 0G Chain (mcp-deployer) without a custom image.
  const ogPassthrough = [
    'OG_STORAGE_PRIVATE_KEY',
    'OG_STORAGE_KV_URL',
    'OG_STORAGE_RPC_URL',
    'OG_STORAGE_INDEXER_URL',
    'OG_STORAGE_LOCAL_STREAM_ID',
    'OG_STORAGE_MESH_STREAM_ID',
    'OG_DEPLOY_PRIVATE_KEY',
  ] as const;

  for (const key of ogPassthrough) {
    const val = process.env[key];
    if (val) env.push(`${key}=${val}`);
  }

  return env;
}

export async function ensureWorkspaceContainer(
  workspaceId: string,
  hostWorkspacePath: string,
): Promise<EnsureWorkspaceContainerResult> {
  const containerName = runtimeContainerName(workspaceId);
  const workspaceDir = runtimeWorkspaceDir(workspaceId);
  const bind = workspaceBind(workspaceId, hostWorkspacePath);

  await assertDockerAvailable();
  await ensureRuntimeImageAvailable();
  await ensureWorkspaceVolumeExists();

  try {
    // Generic base images (e.g. `ubuntu:24.04` used in tests) have a CMD that
    // exits immediately under Docker. Override with a keep-alive so the
    // container stays running for inspection. The crucible-runtime image
    // ships its own CMD that supervises mcp-chain and mcp-compiler.
    const isCrucibleRuntime = RUNTIME_IMAGE.startsWith('crucible-runtime');
    await withRetry(() =>
      withTimeout(
        docker.createContainer({
          name: containerName,
          Image: RUNTIME_IMAGE,
          WorkingDir: workspaceDir,
          ...(isCrucibleRuntime ? {} : { Cmd: ['sh', '-lc', 'while true; do sleep 3600; done'] }),
          Env: buildContainerEnv(workspaceId, workspaceDir),
          ExposedPorts: {
            [`${CONTAINER_CHAIN_PORT}/tcp`]: {},
            [`${CONTAINER_COMPILER_PORT}/tcp`]: {},
            [`${CONTAINER_DEPLOYER_PORT}/tcp`]: {},
            [`${CONTAINER_WALLET_PORT}/tcp`]: {},
            [`${CONTAINER_MEMORY_PORT}/tcp`]: {},
            [`${CONTAINER_TERMINAL_PORT}/tcp`]: {},
            [`${CONTAINER_DEVTOOLS_PORT}/tcp`]: {},
          },
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            Binds: [bind],
            // Empty HostPort = Docker assigns a free port on the host.
            PortBindings: {
              [`${CONTAINER_CHAIN_PORT}/tcp`]: [{ HostPort: '' }],
              [`${CONTAINER_COMPILER_PORT}/tcp`]: [{ HostPort: '' }],
              [`${CONTAINER_DEPLOYER_PORT}/tcp`]: [{ HostPort: '' }],
              [`${CONTAINER_WALLET_PORT}/tcp`]: [{ HostPort: '' }],
              [`${CONTAINER_MEMORY_PORT}/tcp`]: [{ HostPort: '' }],
              [`${CONTAINER_TERMINAL_PORT}/tcp`]: [{ HostPort: '' }],
              [`${CONTAINER_DEVTOOLS_PORT}/tcp`]: [{ HostPort: '' }],
            },
          },
        }),
        `Create container ${containerName}`,
      ),
    );
  } catch (error) {
    if (!isDockerConflict(error)) throw error;
  }

  const inspect = await getContainerInspect(containerName);

  if (!inspect) {
    throw new Error(`Container ${containerName} missing immediately after creation`);
  }

  if (!inspect.State?.Running) {
    await withRetry(() =>
      withTimeout(docker.getContainer(containerName).start(), `Start container ${containerName}`),
    );
  }

  // Re-inspect after start so State.StartedAt and PortBindings reflect the
  // actual runtime state, not Docker's pre-start zero values.
  const freshInspect = await getContainerInspect(containerName);
  const startedAtMs = Date.parse(freshInspect?.State?.StartedAt ?? '');

  const ports: WorkspaceRuntimePorts = {
    chain: freshInspect ? extractHostPort(freshInspect, CONTAINER_CHAIN_PORT) : null,
    compiler: freshInspect ? extractHostPort(freshInspect, CONTAINER_COMPILER_PORT) : null,
    deployer: freshInspect ? extractHostPort(freshInspect, CONTAINER_DEPLOYER_PORT) : null,
    wallet: freshInspect ? extractHostPort(freshInspect, CONTAINER_WALLET_PORT) : null,
    memory: freshInspect ? extractHostPort(freshInspect, CONTAINER_MEMORY_PORT) : null,
    terminal: freshInspect ? extractHostPort(freshInspect, CONTAINER_TERMINAL_PORT) : null,
    devtools: freshInspect ? extractHostPort(freshInspect, CONTAINER_DEVTOOLS_PORT) : null,
  };

  const ready = await waitForRuntimeReady(ports);

  return {
    containerName,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    ports,
    ready,
  };
}

export async function getWorkspaceContainerPorts(
  workspaceId: string,
): Promise<WorkspaceRuntimePorts | null> {
  const containerName = runtimeContainerName(workspaceId);
  const inspect = await getContainerInspect(containerName);
  if (!inspect) return null;

  return {
    chain: extractHostPort(inspect, CONTAINER_CHAIN_PORT),
    compiler: extractHostPort(inspect, CONTAINER_COMPILER_PORT),
    deployer: extractHostPort(inspect, CONTAINER_DEPLOYER_PORT),
    wallet: extractHostPort(inspect, CONTAINER_WALLET_PORT),
    memory: extractHostPort(inspect, CONTAINER_MEMORY_PORT),
    terminal: extractHostPort(inspect, CONTAINER_TERMINAL_PORT),
    devtools: extractHostPort(inspect, CONTAINER_DEVTOOLS_PORT),
  };
}

export function runtimeServiceBaseUrl(port: number): string {
  return `http://${RUNTIME_HOST}:${port}`;
}
