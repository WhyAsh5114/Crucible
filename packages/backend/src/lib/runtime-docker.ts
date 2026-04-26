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
const RUNTIME_IMAGE = process.env['CRUCIBLE_RUNTIME_IMAGE'] ?? 'ubuntu:24.04';
const DOCKER_RETRY_COUNT = Number(process.env['CRUCIBLE_DOCKER_RETRY_COUNT'] ?? '2');
const DOCKER_TIMEOUT_MS = Number(process.env['CRUCIBLE_DOCKER_TIMEOUT_MS'] ?? '15000');
const VOLUME_MOUNT_ROOT = process.env['CRUCIBLE_RUNTIME_VOLUME_ROOT'] ?? '/workspace-root';
const WORKSPACES_VOLUME = process.env['CRUCIBLE_WORKSPACES_VOLUME'] ?? 'crucible-workspaces-data';

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

export async function ensureWorkspaceContainer(workspaceId: string, hostWorkspacePath: string) {
  const containerName = runtimeContainerName(workspaceId);
  const workspaceDir = runtimeWorkspaceDir(workspaceId);
  const bind = workspaceBind(workspaceId, hostWorkspacePath);

  await assertDockerAvailable();
  await ensureRuntimeImageAvailable();
  await ensureWorkspaceVolumeExists();

  try {
    await withRetry(() =>
      withTimeout(
        docker.createContainer({
          name: containerName,
          Image: RUNTIME_IMAGE,
          WorkingDir: workspaceDir,
          Cmd: ['sh', '-lc', 'while true; do sleep 3600; done'],
          HostConfig: {
            RestartPolicy: { Name: 'unless-stopped' },
            Binds: [bind],
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

  const startedAtMs = Date.parse(inspect.State?.StartedAt ?? '');

  return {
    containerName,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
  };
}
