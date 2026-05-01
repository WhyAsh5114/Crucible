import {
  workspaceHostPath,
  collectWorkspaceFiles,
  provisionWorkspaceDirectory,
  writeWorkspaceFile,
} from '../lib/workspace-fs';
import {
  ChainStateSchema,
  WorkspaceIdSchema,
  DeploymentRecordSchema,
  WorkspaceGetResponseSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceCreateResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceUpdateRequestSchema,
  WorkspaceUpdateResponseSchema,
  WorkspaceDeleteResponseSchema,
  FileWriteRequestSchema,
  FileWriteResponseSchema,
  ApiErrorSchema,
  StreamIdSchema,
  AgentEventSchema,
  type TemplateState,
} from '@crucible/types';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { createApiErrorBody } from '../lib/api-error';
import { startPreview, stopPreview, getPreviewUrl, getPreviewState } from '../lib/preview-manager';
import {
  ensureWorkspaceContainer,
  getWorkspaceContainerPorts,
  runtimeServiceBaseUrl,
  removeWorkspaceContainer,
} from '../lib/runtime-docker';
import { publishAgentEvent, nextAgentSeq, warmAgentSeq } from '../lib/agent-bus';
import { readChatHistory } from '../lib/chat-log';
import { requireSession } from '../lib/auth';
import { cancelAgentTurn } from '../lib/agent-cancel';
import { loopbackFetch } from '../lib/loopback-fetch';
import { generateWorkspaceName } from '../lib/workspace-name';
import { rm } from 'node:fs/promises';

type ApiVariables = { userId: string };

// ── OpenAPI route definitions ────────────────────────────────────────────────

const createWorkspaceRoute = createRoute({
  method: 'post',
  path: '/workspace',
  request: {
    body: {
      content: { 'application/json': { schema: WorkspaceCreateRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: WorkspaceCreateResponseSchema } },
      description: 'Workspace created',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    409: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Conflict',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    500: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Internal error',
    },
  },
});

const getWorkspaceRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WorkspaceGetResponseSchema } },
      description: 'Workspace state',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Not found',
    },
  },
});

const listWorkspacesRoute = createRoute({
  method: 'get',
  path: '/workspaces',
  responses: {
    200: {
      content: { 'application/json': { schema: WorkspaceListResponseSchema } },
      description: 'Workspaces owned by the authenticated user',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
  },
});

const updateWorkspaceRoute = createRoute({
  method: 'patch',
  path: '/workspace/{id}',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    body: {
      content: { 'application/json': { schema: WorkspaceUpdateRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WorkspaceUpdateResponseSchema } },
      description: 'Workspace renamed',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
  },
});

const deleteWorkspaceRoute = createRoute({
  method: 'delete',
  path: '/workspace/{id}',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WorkspaceDeleteResponseSchema } },
      description: 'Workspace deleted',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
    500: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Internal error',
    },
  },
});

const fileWriteRoute = createRoute({
  method: 'put',
  path: '/workspace/{id}/file',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    body: {
      content: { 'application/json': { schema: FileWriteRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: FileWriteResponseSchema } },
      description: 'File written successfully',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace not found',
    },
    500: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Internal error',
    },
  },
});

const ChatHistoryResponseSchema = z.object({
  events: z.array(AgentEventSchema),
});

const CancelAgentResponseSchema = z.object({
  cancelled: z.boolean(),
});

const cancelAgentRoute = createRoute({
  method: 'post',
  path: '/workspace/{id}/cancel',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CancelAgentResponseSchema } },
      description: 'Cancel signal delivered (or no active turn)',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace not found',
    },
  },
});

const getChatHistoryRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}/chat/history',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ChatHistoryResponseSchema } },
      description: 'Persisted agent event history for the workspace',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace not found',
    },
  },
});

// ── Chain auto-boot ──────────────────────────────────────────────────────────

/**
 * Hit the workspace's mcp-chain HTTP `/start_node` to bring up Hardhat, then
 * read `/state` and persist the result on `workspace_runtime.chainState`.
 *
 * Called eagerly from `spawnRuntimeForWorkspace` so a fresh workspace's
 * preview iframe (and wagmi polls inside it) hit a live chain immediately
 * rather than a 503 cascade until the agent gets around to calling
 * `start_node` itself. The agent can still call `start_node` later — it's
 * idempotent on the chain side.
 *
 * Failures are logged and swallowed; the runtime stays up so the user can
 * recover via the agent or a manual retry.
 */
async function bootChain(workspaceId: string, chainPort: number): Promise<void> {
  const base = `http://127.0.0.1:${chainPort}`;
  const startRes = await loopbackFetch(`${base}/start_node`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!startRes.ok) {
    throw new Error(`start_node returned HTTP ${startRes.status}`);
  }

  const stateRes = await loopbackFetch(`${base}/state`, {
    headers: { accept: 'application/json' },
  });
  if (!stateRes.ok) {
    throw new Error(`/state returned HTTP ${stateRes.status}`);
  }
  const state = (await stateRes.json()) as Record<string, unknown>;

  await prisma.workspaceRuntime.update({
    where: { workspaceId },
    data: { chainState: state as Prisma.InputJsonValue },
  });
}

/**
 * Compile + deploy `contracts/Counter.sol` (the workspace template) so the
 * preview iframe lands on a live contract address from the very first frame.
 * The address + ABI get written to `frontend/public/contracts.json`, which the
 * scaffold App.tsx fetches at runtime and uses for `useReadContract` /
 * `useWriteContract` calls.
 *
 * This makes the wallet approval flow testable out of the box: clicking
 * Increment in the preview encodes the function selector, sends an
 * eth_sendTransaction, the bridge routes it through the wallet pane, the user
 * approves, mcp-chain mines, the count refetches.
 *
 * Idempotent across container restarts: Hardhat state is in-memory, so every
 * boot needs a fresh deploy. Best-effort — failures are logged but don't
 * block the runtime from coming up; the agent can still recover later.
 */
/**
 * In-memory template-deploy state per workspace, surfaced via the GET
 * workspace response so the boot overlay can show a "Compiling Counter…" /
 * "Deploying Counter…" phase and only clear once contracts.json has been
 * written. Volatile (resets on backend restart); the workspace re-deploys on
 * next boot anyway because Hardhat state is in-memory.
 */
const templateStates = new Map<string, TemplateState>();

function makeIdleTemplateState(): TemplateState {
  return { phase: 'idle', contractAddress: null, message: null, updatedAt: Date.now() };
}

function setTemplateState(
  workspaceId: string,
  patch: Partial<TemplateState> & { phase: TemplateState['phase'] },
): void {
  const next: TemplateState = {
    ...(templateStates.get(workspaceId) ?? makeIdleTemplateState()),
    ...patch,
    updatedAt: Date.now(),
  };
  templateStates.set(workspaceId, next);
}

export function getTemplateState(workspaceId: string): TemplateState {
  return templateStates.get(workspaceId) ?? makeIdleTemplateState();
}

async function deployCounterTemplate(
  workspaceId: string,
  workspaceDir: string,
  compilerPort: number,
  deployerPort: number,
): Promise<void> {
  const path = await import('node:path');
  const { writeFile, stat } = await import('node:fs/promises');

  // If the workspace's Counter.sol was removed (e.g. agent rewrote the
  // contract layout), don't error out — mark template as unavailable so the
  // boot overlay clears and the agent can take over.
  try {
    await stat(path.join(workspaceDir, 'contracts', 'Counter.sol'));
  } catch {
    setTemplateState(workspaceId, {
      phase: 'unavailable',
      message: 'contracts/Counter.sol not present',
    });
    return;
  }

  setTemplateState(workspaceId, { phase: 'compiling', message: 'Compiling Counter.sol…' });
  const compileRes = await loopbackFetch(`http://127.0.0.1:${compilerPort}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourcePath: 'contracts/Counter.sol' }),
  });
  if (!compileRes.ok) {
    const message = `compile returned HTTP ${compileRes.status}`;
    setTemplateState(workspaceId, { phase: 'failed', message });
    throw new Error(message);
  }
  const compiled = (await compileRes.json()) as {
    contracts: Array<{ name: string; abi: unknown }>;
  };
  const counter = compiled.contracts.find(
    (c) => c.name === 'Counter' || c.name.endsWith(':Counter') || c.name.endsWith('/Counter'),
  );
  if (!counter) {
    const message = `compile output missing "Counter" — got: ${compiled.contracts.map((c) => c.name).join(', ')}`;
    setTemplateState(workspaceId, { phase: 'failed', message });
    throw new Error(message);
  }

  setTemplateState(workspaceId, { phase: 'deploying', message: 'Deploying Counter to chain…' });
  const deployRes = await loopbackFetch(`http://127.0.0.1:${deployerPort}/deploy_local`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractName: 'Counter', constructorData: '0x' }),
  });
  if (!deployRes.ok) {
    const message = `deploy_local returned HTTP ${deployRes.status}`;
    setTemplateState(workspaceId, { phase: 'failed', message });
    throw new Error(message);
  }
  const deployed = (await deployRes.json()) as { address: string; txHash: string };

  // Write the manifest the preview's React app fetches at boot. Using
  // `frontend/public/` means Vite serves it at the iframe origin without
  // bundler involvement; the path is `/contracts.json`.
  const manifest = {
    counter: {
      address: deployed.address,
      abi: counter.abi,
      deployTxHash: deployed.txHash,
      deployedAt: Date.now(),
    },
  };
  await writeFile(
    path.join(workspaceDir, 'frontend', 'public', 'contracts.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  setTemplateState(workspaceId, {
    phase: 'ready',
    contractAddress: deployed.address,
    message: `Counter deployed at ${deployed.address}`,
  });
  console.log(`[workspace ${workspaceId}] Counter deployed at ${deployed.address}`);
}

// ── Background runtime bootstrap ─────────────────────────────────────────────

/**
 * Spawn the per-workspace Docker container and upsert the WorkspaceRuntime
 * row. Runs as a background task triggered by workspace creation so the HTTP
 * create response returns immediately and the UI can navigate to the
 * workspace URL while the container boots.
 *
 * Status transitions: starting → ready | degraded | crashed.
 */
async function spawnRuntimeForWorkspace(workspaceId: string, directoryPath: string): Promise<void> {
  try {
    await prisma.workspaceRuntime.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        status: 'starting',
        startedAt: new Date(),
        chainState: Prisma.JsonNull,
      },
      update: { status: 'starting' },
      select: { runtimeId: true },
    });

    const container = await ensureWorkspaceContainer(workspaceId, directoryPath);

    await prisma.workspaceRuntime.update({
      where: { workspaceId },
      data: {
        status: container.ready ? 'ready' : 'degraded',
        startedAt: new Date(container.startedAtMs),
        chainPort: container.ports.chain,
        compilerPort: container.ports.compiler,
        deployerPort: container.ports.deployer,
        walletPort: container.ports.wallet,
        terminalPort: container.ports.terminal,
      },
    });

    // Auto-boot the Hardhat node now that the container is up — without this
    // the chain stays down until the agent explicitly calls start_node, which
    // means the preview iframe gets a flood of 503s on every wagmi poll and
    // the wallet pane shows "no account connected" forever. Booting eagerly
    // is the only way to make a fresh workspace land in a usable state.
    // After the chain is up, also auto-compile + deploy the workspace's
    // Counter.sol so the preview's scaffold has a live contract address to
    // exercise the wallet approval flow against from the very first frame.
    if (container.ports.chain !== null) {
      const chainPort = container.ports.chain;
      const compilerPort = container.ports.compiler;
      const deployerPort = container.ports.deployer;
      void bootChain(workspaceId, chainPort)
        .then(async () => {
          if (compilerPort === null || deployerPort === null) return;
          // Hard cap the template deploy at 90s so a slow/failed solc download
          // can never wedge the boot overlay forever. On timeout we mark the
          // template as failed and let the workspace open — the agent can
          // recover via tools later.
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('counter deploy timed out after 90s')), 90_000),
          );
          try {
            await Promise.race([
              deployCounterTemplate(workspaceId, directoryPath, compilerPort, deployerPort),
              timeout,
            ]);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[workspace ${workspaceId}] counter deploy failed:`, message);
            // Make sure the state ends in a settled phase so the boot overlay
            // doesn't spin indefinitely.
            const state = getTemplateState(workspaceId);
            if (
              state.phase !== 'ready' &&
              state.phase !== 'failed' &&
              state.phase !== 'unavailable'
            ) {
              setTemplateState(workspaceId, { phase: 'failed', message });
            }
          }
        })
        .catch((err) => {
          console.warn(`[workspace ${workspaceId}] chain boot failed:`, err);
        });
    }

    // Start the per-workspace preview server in the background so
    // GET /api/workspace/:id eventually returns a non-null previewUrl.
    void startPreview(workspaceId, directoryPath).catch((err) => {
      console.warn(`[workspace ${workspaceId}] preview start failed:`, err);
    });
  } catch (err) {
    // Mark the runtime crashed so the UI can show a degraded state instead
    // of looking idle forever. The error itself is intentionally swallowed:
    // the user can still browse the workspace and retry via runtime API.
    console.error(`[workspace ${workspaceId}] runtime spawn failed:`, err);
    await prisma.workspaceRuntime
      .updateMany({
        where: { workspaceId, status: 'starting' },
        data: { status: 'crashed' },
      })
      .catch(() => undefined);
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

const workspaceApiBase = new OpenAPIHono<{ Variables: ApiVariables }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        createApiErrorBody('bad_request', result.error.issues[0]?.message ?? 'Validation failed'),
        400,
      );
    }
    return undefined;
  },
});

// Auth guard: every route in this sub-app requires a valid session.
// Fast-path skips DB round-trip when userId was already set by a parent
// middleware (e.g. when mounted via app.route() in index.ts).
workspaceApiBase.use('*', requireSession);

export const workspaceApi = workspaceApiBase
  .openapi(createWorkspaceRoute, async (c) => {
    const { name } = c.req.valid('json');
    const userId = c.get('userId');

    // Auto-generate a friendly name when the client sends the placeholder
    // "Untitled workspace" — keeps the workspace list scannable instead of
    // a wall of identical entries. Explicit user-provided names pass through.
    const effectiveName =
      name.trim() === '' || name.trim().toLowerCase() === 'untitled workspace'
        ? generateWorkspaceName()
        : name;

    let createdId: string | null = null;

    try {
      const created = await prisma.workspace.create({
        data: {
          deployments: [],
          name: effectiveName,
          directoryPath: `pending://${randomUUID()}`,
          userId,
        },
        select: { id: true },
      });
      createdId = created.id;

      const directoryPath = await provisionWorkspaceDirectory(created.id);
      await prisma.workspace.update({
        where: { id: created.id },
        data: { directoryPath },
        select: { id: true },
      });

      // Kick off the Docker container spawn + runtime row upsert in the
      // background so the create response stays fast. Failures here are
      // surfaced via the runtime status (degraded/crashed) rather than
      // blocking the workspace from being created.
      void spawnRuntimeForWorkspace(created.id, directoryPath);

      const response = WorkspaceCreateResponseSchema.parse({ id: created.id });
      return c.json(response, 201);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json(createApiErrorBody('conflict', 'Workspace metadata already exists'), 409);
      }

      if (createdId) {
        await prisma.workspace.delete({ where: { id: createdId } }).catch(() => undefined);
      }

      return c.json(createApiErrorBody('internal', 'Failed to create workspace metadata'), 500);
    }
  })
  .openapi(getWorkspaceRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const row = await prisma.workspace.findUnique({
      where: { id },
      include: { runtime: true },
    });

    // Treat foreign workspaces as 404 to avoid leaking the existence of
    // someone else's workspace IDs to a probing client.
    if (!row || row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    if (row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    // Validate the DB-stored chainState/deployments to detect malformed rows,
    // but pass the *raw wire form* (string-encoded bigints) to the response
    // rather than the parsed runtime form. ChainStateSchema/DeploymentRecord
    // use `BigIntStringSchema` which transforms wire string → runtime bigint;
    // re-parsing the transformed output through WorkspaceGetResponseSchema
    // fails ("expected string, received bigint"), and even if it didn't,
    // c.json() can't serialize a bigint. The client-side schema parses the
    // wire form back into the runtime form.
    const chainStateValid = ChainStateSchema.safeParse(row.runtime?.chainState).success;
    const deploymentsValid = DeploymentRecordSchema.array().safeParse(row.deployments).success;
    const files = await collectWorkspaceFiles(row.directoryPath || workspaceHostPath(row.id));

    // If the runtime is ready but no preview is running (e.g. backend restarted
    // and lost the in-memory Map, or the process crashed), re-launch it now.
    const directoryPath = row.directoryPath || workspaceHostPath(row.id);
    if (row.runtime?.status === 'ready' && !getPreviewUrl(id)) {
      void startPreview(id, directoryPath).catch((err) => {
        console.warn(`[workspace ${id}] preview auto-restart failed:`, err);
      });
    }

    // Cast through `unknown`: the route's response schema uses
    // BigIntStringSchema whose *output* type is `bigint`, but JSON can't carry
    // a bigint and the frontend re-parses the wire string into a bigint
    // itself. So at runtime the body is wire-form, while Hono's typed
    // signature expects the post-parse runtime form. The cast bridges that
    // intentional asymmetry without changing the schema contract.
    type WireResponse = z.input<typeof WorkspaceGetResponseSchema>;
    const body: WireResponse = {
      files,
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.getTime(),
      previewUrl: getPreviewUrl(id) ?? row.runtime?.previewUrl ?? null,
      previewState: getPreviewState(id),
      templateState: getTemplateState(id),
      chainState: (chainStateValid ? row.runtime?.chainState : null) as WireResponse['chainState'],
      deployments: (deploymentsValid ? row.deployments : []) as WireResponse['deployments'],
      terminalSessionId: row.runtime?.terminalSessionId ?? null,
    };
    return c.json(body as unknown as z.infer<typeof WorkspaceGetResponseSchema>, 200);
  })
  .openapi(listWorkspacesRoute, async (c) => {
    const userId = c.get('userId');

    const rows = await prisma.workspace.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { runtime: { select: { status: true } } },
    });

    const response = WorkspaceListResponseSchema.parse({
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.getTime(),
        runtimeStatus: row.runtime?.status ?? null,
      })),
    });

    return c.json(response, 200);
  })
  .openapi(updateWorkspaceRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const userId = c.get('userId');

    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!row || row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const updated = await prisma.workspace.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    });
    return c.json(WorkspaceUpdateResponseSchema.parse(updated), 200);
  })
  .openapi(deleteWorkspaceRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { userId: true, directoryPath: true },
    });
    if (!row || row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    // Best-effort cleanup of runtime resources before dropping the row. We
    // don't roll back the DB delete if a cleanup step fails (the container
    // could be already gone, the directory could be missing) — the row going
    // away is what the user actually asked for, and orphaned containers are
    // recoverable via `docker rm`.
    try {
      await cancelAgentTurn(id);
    } catch {
      /* ignore */
    }
    try {
      stopPreview(id);
    } catch {
      /* ignore */
    }
    try {
      await removeWorkspaceContainer(id);
    } catch (err) {
      console.warn(`[workspace ${id}] container cleanup failed:`, err);
    }

    // Cascade delete: workspace_runtime row goes via FK onDelete: Cascade.
    try {
      await prisma.workspace.delete({ where: { id } });
    } catch (err) {
      console.error(`[workspace ${id}] DB delete failed:`, err);
      return c.json(createApiErrorBody('internal', 'Failed to delete workspace'), 500);
    }

    // Best-effort: remove the on-disk workspace directory. Failure here is
    // not fatal — the DB row is already gone.
    if (row.directoryPath && !row.directoryPath.startsWith('pending://')) {
      void rm(row.directoryPath, { recursive: true, force: true }).catch((err) => {
        console.warn(`[workspace ${id}] directory cleanup failed:`, err);
      });
    }

    return c.json(WorkspaceDeleteResponseSchema.parse({ id, deleted: true }), 200);
  })
  .openapi(fileWriteRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { path: filePath, content } = c.req.valid('json');
    const userId = c.get('userId');

    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true, directoryPath: true },
    });

    if (!row) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    if (row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const workspaceDir = row.directoryPath?.startsWith('pending://')
      ? workspaceHostPath(row.id)
      : (row.directoryPath ?? workspaceHostPath(row.id));

    try {
      const wf = await writeWorkspaceFile(row.id, filePath, content, workspaceDir);

      // Lift seq counter past any persisted events from previous runs so we
      // don't collide with seq numbers already on disk after a hot reload.
      await warmAgentSeq(row.id);

      // Publish a file_write event so SSE subscribers (e.g. the editor)
      // see the change without polling.
      const streamId = StreamIdSchema.parse(row.id);
      publishAgentEvent(row.id, {
        streamId,
        seq: nextAgentSeq(row.id),
        emittedAt: Date.now(),
        type: 'file_write',
        path: wf.path,
        lang: wf.lang,
        hash: wf.hash,
        content: wf.content,
      });

      return c.json(FileWriteResponseSchema.parse(wf), 200);
    } catch (error) {
      return c.json(
        createApiErrorBody('internal', error instanceof Error ? error.message : 'Write failed'),
        500,
      );
    }
  })
  .openapi(getChatHistoryRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    try {
      const events = await readChatHistory(id);
      return c.json(ChatHistoryResponseSchema.parse({ events }), 200);
    } catch (err) {
      console.warn(
        `[workspace ${id}] chat history read failed:`,
        err instanceof Error ? err.message : err,
      );
      return c.json(ChatHistoryResponseSchema.parse({ events: [] }), 200);
    }
  })
  .openapi(cancelAgentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const cancelled = cancelAgentTurn(id);
    return c.json(CancelAgentResponseSchema.parse({ cancelled }), 200);
  })
  .get('/workspace/:id/devtools/events', async (c) => {
    const id = c.req.param('id');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const ports = await getWorkspaceContainerPorts(workspace.id).catch(() => null);
    if (!ports?.devtools) {
      return c.json({ error: 'devtools not ready' }, 503);
    }

    const upstreamUrl = `${runtimeServiceBaseUrl(ports.devtools)}/events`;
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { accept: 'text/event-stream' },
        signal: c.req.raw.signal,
      });
    } catch {
      return c.json({ error: 'devtools not ready' }, 503);
    }

    if (!upstream.ok || !upstream.body) {
      return c.json({ error: 'devtools not ready' }, 503);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
