type DockerCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const RUNTIME_IMAGE = process.env['CRUCIBLE_RUNTIME_IMAGE'] ?? 'alpine:3.20';

async function runDocker(args: string[]): Promise<DockerCommandResult> {
  const process = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  return {
    code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

function runtimeContainerName(workspaceId: string): string {
  return `crucible-ws-${workspaceId}`;
}

export async function stopWorkspaceContainer(workspaceId: string): Promise<void> {
  const containerName = runtimeContainerName(workspaceId);

  const dockerCheck = await runDocker(['version', '--format', '{{.Server.Version}}']);
  if (dockerCheck.code !== 0) {
    throw new Error(`Docker is unavailable: ${dockerCheck.stderr || dockerCheck.stdout}`);
  }

  const existing = await runDocker([
    'ps',
    '-a',
    '--filter',
    `name=^/${containerName}$`,
    '--format',
    '{{.Names}}',
  ]);

  if (existing.code !== 0) {
    throw new Error(`Failed to inspect runtime container: ${existing.stderr || existing.stdout}`);
  }

  if (!existing.stdout) {
    return;
  }

  const running = await runDocker(['inspect', '-f', '{{.State.Running}}', containerName]);
  if (running.code !== 0) {
    throw new Error(`Failed to inspect runtime status: ${running.stderr || running.stdout}`);
  }

  if (running.stdout === 'true') {
    const stop = await runDocker(['stop', containerName]);
    if (stop.code !== 0) {
      throw new Error(`Failed to stop runtime container: ${stop.stderr || stop.stdout}`);
    }
  }
}

export async function ensureWorkspaceContainer(workspaceId: string, hostWorkspacePath: string) {
  const containerName = runtimeContainerName(workspaceId);

  const dockerCheck = await runDocker(['version', '--format', '{{.Server.Version}}']);
  if (dockerCheck.code !== 0) {
    throw new Error(`Docker is unavailable: ${dockerCheck.stderr || dockerCheck.stdout}`);
  }

  const existing = await runDocker([
    'ps',
    '-a',
    '--filter',
    `name=^/${containerName}$`,
    '--format',
    '{{.Names}}',
  ]);

  if (existing.code !== 0) {
    throw new Error(`Failed to inspect runtime container: ${existing.stderr || existing.stdout}`);
  }

  if (!existing.stdout) {
    const create = await runDocker([
      'create',
      '--name',
      containerName,
      '--restart',
      'unless-stopped',
      '-v',
      `${hostWorkspacePath}:/workspace`,
      '-w',
      '/workspace',
      RUNTIME_IMAGE,
      'sh',
      '-lc',
      'while true; do sleep 3600; done',
    ]);

    if (create.code !== 0) {
      throw new Error(`Failed to create runtime container: ${create.stderr || create.stdout}`);
    }
  }

  const running = await runDocker(['inspect', '-f', '{{.State.Running}}', containerName]);
  if (running.code !== 0) {
    throw new Error(`Failed to inspect runtime status: ${running.stderr || running.stdout}`);
  }

  if (running.stdout !== 'true') {
    const start = await runDocker(['start', containerName]);
    if (start.code !== 0) {
      throw new Error(`Failed to start runtime container: ${start.stderr || start.stdout}`);
    }
  }

  const startedAt = await runDocker(['inspect', '-f', '{{.State.StartedAt}}', containerName]);
  const startedAtMs = Date.parse(startedAt.stdout);

  return {
    containerName,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
  };
}
