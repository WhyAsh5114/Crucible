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
  MemoryPatternSchema,
  StreamIdSchema,
  AgentEventSchema,
  ChatSessionListResponseSchema,
  ChatSessionCreateRequestSchema,
  ChatSessionRenameRequestSchema,
  ChatSessionDeleteResponseSchema,
  AxlKeyRegisterRequestSchema,
  AxlKeyRegisterResponseSchema,
  MeshPeersResponseSchema,
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
import { readChatHistory, migrateLegacyChatLog, disposeChatLog } from '../lib/chat-log';
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

// ── Session route definitions ────────────────────────────────────────────────

const sessionParams = z.object({ id: WorkspaceIdSchema });
const sessionItemParams = z.object({ id: WorkspaceIdSchema, sessionId: z.string() });

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}/sessions',
  request: { params: sessionParams },
  responses: {
    200: {
      content: { 'application/json': { schema: ChatSessionListResponseSchema } },
      description: 'List of chat sessions for the workspace',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
  },
});

const createSessionRoute = createRoute({
  method: 'post',
  path: '/workspace/{id}/sessions',
  request: {
    params: sessionParams,
    body: {
      content: { 'application/json': { schema: ChatSessionCreateRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ChatSessionListResponseSchema } },
      description: 'Session created; returns full updated session list',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
  },
});

const renameSessionRoute = createRoute({
  method: 'patch',
  path: '/workspace/{id}/sessions/{sessionId}',
  request: {
    params: sessionItemParams,
    body: {
      content: { 'application/json': { schema: ChatSessionRenameRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ChatSessionListResponseSchema } },
      description: 'Session renamed; returns full updated session list',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
  },
});

const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/workspace/{id}/sessions/{sessionId}',
  request: { params: sessionItemParams },
  responses: {
    200: {
      content: { 'application/json': { schema: ChatSessionDeleteResponseSchema } },
      description: 'Session deleted',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Last session cannot be deleted',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
  },
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
    query: z.object({ sessionId: z.string().optional() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ChatHistoryResponseSchema } },
      description: 'Persisted agent event history for the session',
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

const PurgeMemoryResponseSchema = z.object({ deleted: z.number().int().nonnegative() });

const MemoryPatternsResponseSchema = z.object({
  patterns: z.array(MemoryPatternSchema),
});

const listMemoryPatternsRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}/memory/patterns',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    query: z.object({ scope: z.enum(['local', 'mesh']).optional() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MemoryPatternsResponseSchema } },
      description: 'Memory patterns for this workspace',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Memory service not ready',
    },
  },
});

const EmbedMemoryResponseSchema = z.object({
  embeddings: z.array(z.object({ id: z.string(), vector: z.array(z.number()) })),
});

const embedMemoryRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}/memory/embed',
  request: { params: z.object({ id: WorkspaceIdSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: EmbedMemoryResponseSchema } },
      description: 'Embedding vectors for all patterns',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Memory service not ready or embeddings unavailable',
    },
  },
});

const purgeMemoryRoute = createRoute({
  method: 'delete',
  path: '/workspace/{id}/memory',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    query: z.object({ scope: z.enum(['local', 'mesh']).optional() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PurgeMemoryResponseSchema } },
      description: 'Patterns purged',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Memory service not ready',
    },
  },
});

// ── AXL key registry ─────────────────────────────────────────────────────────

/** mcp-mesh calls this once on startup (from inside the container) to
 *  publish its AXL public key.  The route is protected by
 *  `requireContainerAuth` (X-Container-Secret header) rather than a user
 *  session, because the container does not hold user credentials. */
const registerAxlKeyRoute = createRoute({
  method: 'post',
  path: '/workspace/{id}/axl-key',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    headers: z.object({ 'x-container-secret': z.string() }),
    body: {
      content: { 'application/json': { schema: AxlKeyRegisterRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: AxlKeyRegisterResponseSchema } },
      description: 'AXL key registered',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace runtime not found',
    },
  },
});

/** Returns the AXL public keys of all other workspace containers that belong
 *  to the same operator user.  Only workspaces that have already registered
 *  a key are included.  The calling workspace's own entry is excluded. */
const getMeshPeersRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}/mesh-peers',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    headers: z.object({ 'x-container-secret': z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MeshPeersResponseSchema } },
      description: 'Peer AXL public keys',
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
 * Compile + deploy `contracts/DemoVault.sol` (the workspace scaffold) so the
 * preview iframe lands on a live contract address from the very first frame.
 * The address + ABI get written to `frontend/public/contracts.json`, which the
 * scaffold App.tsx fetches at runtime and uses for `useReadContract` /
 * `useWriteContract` calls.
 *
 * This makes the deposit/withdraw flow testable out of the box immediately
 * after workspace creation. The withdraw will revert (seeded bug) — that is
 * intentional and is the trigger for the agent self-healing loop.
 *
 * Idempotent across container restarts: Hardhat state is in-memory, so every
 * boot needs a fresh deploy. Best-effort — failures are logged but don't
 * block the runtime from coming up; the agent can still recover later.
 */
/**
 * In-memory template-deploy state per workspace, surfaced via the GET
 * workspace response so the boot overlay can show a "Compiling DemoVault…" /
 * "Deploying DemoVault…" phase and only clear once contracts.json has been
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

  // If the workspace's DemoVault.sol was removed (e.g. agent rewrote the
  // contract layout), don't error out — mark template as unavailable so the
  // boot overlay clears and the agent can take over.
  try {
    await stat(path.join(workspaceDir, 'contracts', 'DemoVault.sol'));
  } catch {
    setTemplateState(workspaceId, {
      phase: 'unavailable',
      message: 'contracts/DemoVault.sol not present',
    });
    return;
  }

  setTemplateState(workspaceId, { phase: 'compiling', message: 'Compiling DemoVault.sol…' });
  const compileRes = await loopbackFetch(`http://127.0.0.1:${compilerPort}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourcePath: 'contracts/DemoVault.sol' }),
  });
  if (!compileRes.ok) {
    const message = `compile returned HTTP ${compileRes.status}`;
    setTemplateState(workspaceId, { phase: 'failed', message });
    throw new Error(message);
  }
  const compiled = (await compileRes.json()) as {
    contracts: Array<{ name: string; abi: unknown }>;
  };
  const vault = compiled.contracts.find(
    (c) => c.name === 'DemoVault' || c.name.endsWith(':DemoVault') || c.name.endsWith('/DemoVault'),
  );
  if (!vault) {
    const message = `compile output missing "DemoVault" — got: ${compiled.contracts.map((c) => c.name).join(', ')}`;
    setTemplateState(workspaceId, { phase: 'failed', message });
    throw new Error(message);
  }

  setTemplateState(workspaceId, { phase: 'deploying', message: 'Deploying DemoVault to chain…' });
  const deployRes = await loopbackFetch(`http://127.0.0.1:${deployerPort}/deploy_local`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractName: 'DemoVault', constructorData: '0x' }),
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
    vault: {
      address: deployed.address,
      abi: vault.abi,
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
    message: `DemoVault deployed at ${deployed.address}`,
  });
  console.log(`[workspace ${workspaceId}] DemoVault deployed at ${deployed.address}`);
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
        memoryPort: container.ports.memory,
        meshPort: container.ports.mesh,
        terminalPort: container.ports.terminal,
        devtoolsPort: container.ports.devtools,
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

      // Publish a file_write event to the most-recently-active session so SSE
      // subscribers (e.g. the editor pane) see the change without polling.
      const activeSession = await prisma.chatSession.findFirst({
        where: { workspaceId: row.id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (activeSession) {
        await warmAgentSeq(row.id, activeSession.id);
        const streamId = StreamIdSchema.parse(row.id);
        publishAgentEvent(row.id, activeSession.id, {
          streamId,
          seq: nextAgentSeq(row.id, activeSession.id),
          emittedAt: Date.now(),
          type: 'file_write',
          path: wf.path,
          lang: wf.lang,
          hash: wf.hash,
          content: wf.content,
        });
      }

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
    const { sessionId: rawSessionId } = c.req.valid('query');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    // Resolve which session to read.
    let sessionId: string | null = null;
    if (rawSessionId) {
      const sess = await prisma.chatSession.findUnique({
        where: { id: rawSessionId },
        select: { id: true, workspaceId: true },
      });
      if (sess && sess.workspaceId === id) sessionId = sess.id;
    } else {
      const latest = await prisma.chatSession.findFirst({
        where: { workspaceId: id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      sessionId = latest?.id ?? null;
    }

    if (!sessionId) {
      return c.json(ChatHistoryResponseSchema.parse({ events: [] }), 200);
    }

    try {
      const events = await readChatHistory(id, sessionId);
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
  // ── Session CRUD ──────────────────────────────────────────────────────────
  .openapi(listSessionsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    let sessions = await prisma.chatSession.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: 'asc' },
    });

    // Auto-migrate legacy chat.jsonl → first session on first load.
    if (sessions.length === 0) {
      const created = await prisma.chatSession.create({
        data: { workspaceId: id, title: 'Chat 1' },
      });
      // Attempt to rename the legacy file; silently ok if not present.
      await migrateLegacyChatLog(id, created.id);
      sessions = [created];
    }

    return c.json(
      ChatSessionListResponseSchema.parse({
        sessions: sessions.map((s) => ({
          ...s,
          createdAt: s.createdAt.getTime(),
          updatedAt: s.updatedAt.getTime(),
        })),
      }),
      200,
    );
  })
  .openapi(createSessionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { title } = c.req.valid('json');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const count = await prisma.chatSession.count({ where: { workspaceId: id } });
    const resolvedTitle = title ?? `Chat ${count + 1}`;
    await prisma.chatSession.create({ data: { workspaceId: id, title: resolvedTitle } });

    const sessions = await prisma.chatSession.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: 'asc' },
    });
    return c.json(
      ChatSessionListResponseSchema.parse({
        sessions: sessions.map((s) => ({
          ...s,
          createdAt: s.createdAt.getTime(),
          updatedAt: s.updatedAt.getTime(),
        })),
      }),
      201,
    );
  })
  .openapi(renameSessionRoute, async (c) => {
    const { id, sessionId } = c.req.valid('param');
    const { title } = c.req.valid('json');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.workspaceId !== id) {
      return c.json(createApiErrorBody('not_found', 'Session not found'), 404);
    }

    await prisma.chatSession.update({ where: { id: sessionId }, data: { title } });

    const sessions = await prisma.chatSession.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: 'asc' },
    });
    return c.json(
      ChatSessionListResponseSchema.parse({
        sessions: sessions.map((s) => ({
          ...s,
          createdAt: s.createdAt.getTime(),
          updatedAt: s.updatedAt.getTime(),
        })),
      }),
      200,
    );
  })
  .openapi(deleteSessionRoute, async (c) => {
    const { id, sessionId } = c.req.valid('param');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.workspaceId !== id) {
      return c.json(createApiErrorBody('not_found', 'Session not found'), 404);
    }

    const count = await prisma.chatSession.count({ where: { workspaceId: id } });
    if (count <= 1) {
      return c.json(createApiErrorBody('bad_request', 'Cannot delete the last chat session'), 400);
    }

    await prisma.chatSession.delete({ where: { id: sessionId } });
    disposeChatLog(id, sessionId);

    return c.json(ChatSessionDeleteResponseSchema.parse({ id: sessionId, deleted: true }), 200);
  })
  .openapi(purgeMemoryRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { scope } = c.req.valid('query');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const ports = await getWorkspaceContainerPorts(id).catch(() => null);
    if (!ports?.memory) {
      return c.json(createApiErrorBody('runtime_unavailable', 'Memory service not ready'), 503);
    }

    const url = new URL(`http://127.0.0.1:${ports.memory}/patterns`);
    if (scope) url.searchParams.set('scope', scope);
    const res = await loopbackFetch(url.toString(), { method: 'DELETE' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json(createApiErrorBody('runtime_unavailable', `Memory purge failed: ${text}`), 503);
    }
    const body = (await res.json()) as { deleted: number };
    return c.json(PurgeMemoryResponseSchema.parse(body), 200);
  })
  .openapi(listMemoryPatternsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { scope } = c.req.valid('query');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    type RawPattern = z.infer<typeof MemoryPatternSchema>;
    type RawPage = { patterns: RawPattern[] };

    // Fetch the LOCAL patterns from a single workspace's memory service.
    // Returns an empty array if the container is not running or the service
    // is unreachable — never throws, so a single offline peer can't break
    // the whole pane.
    async function fetchLocalPatterns(workspaceId: string): Promise<RawPattern[]> {
      const ports = await getWorkspaceContainerPorts(workspaceId).catch(() => null);
      if (!ports?.memory) return [];
      const url = `http://127.0.0.1:${ports.memory}/patterns?scope=local&limit=200`;
      try {
        const res = await loopbackFetch(url);
        if (!res.ok) return [];
        const body = (await res.json()) as RawPage;
        return Array.isArray(body.patterns) ? body.patterns : [];
      } catch {
        return [];
      }
    }

    const wantsLocal = scope === undefined || scope === 'local';
    const wantsMesh = scope === undefined || scope === 'mesh';

    // "local" = patterns this workspace itself has remembered.
    const localPromise = wantsLocal ? fetchLocalPatterns(id) : Promise.resolve([] as RawPattern[]);

    // "mesh" = patterns from OTHER workspaces owned by the same user.
    // Each peer workspace's locals are re-tagged scope:'mesh' so the pane
    // can visually separate own discoveries from peer discoveries without
    // requiring producers to write into a separate KV stream.
    let meshPromise: Promise<RawPattern[]> = Promise.resolve([]);
    if (wantsMesh) {
      const siblings = await prisma.workspace.findMany({
        where: { id: { not: id } },
        select: { id: true },
      });
      meshPromise = Promise.all(siblings.map((w) => fetchLocalPatterns(w.id))).then((lists) =>
        lists.flat().map((p) => ({ ...p, scope: 'mesh' as const })),
      );
    }

    const [local, mesh] = await Promise.all([localPromise, meshPromise]);

    // The local memory service may also still hold patterns explicitly written
    // with scope='mesh' (e.g. via the agent's mesh.collect_responses path).
    // Include those when the caller asked for mesh, so we don't silently lose
    // anything that producers actively pushed into the mesh stream.
    if (wantsMesh) {
      const ports = await getWorkspaceContainerPorts(id).catch(() => null);
      if (ports?.memory) {
        try {
          const res = await loopbackFetch(
            `http://127.0.0.1:${ports.memory}/patterns?scope=mesh&limit=200`,
          );
          if (res.ok) {
            const body = (await res.json()) as RawPage;
            if (Array.isArray(body.patterns)) mesh.push(...body.patterns);
          }
        } catch {
          // ignore — already returning peer-derived mesh patterns
        }
      }
    }

    // Deduplicate by pattern ID — local takes priority over mesh.
    // This is necessary because all containers share the same 0G KV stream
    // (same OG_STORAGE_PRIVATE_KEY → same stream ID), so fetching locals from
    // multiple workspaces returns overlapping pattern sets.
    const seen = new Set<string>();
    const deduplicated: RawPattern[] = [];
    for (const p of [...local, ...mesh]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        deduplicated.push(p);
      }
    }

    return c.json(
      { patterns: deduplicated } as unknown as {
        patterns: z.infer<typeof MemoryPatternSchema>[];
      },
      200,
    );
  })
  .openapi(embedMemoryRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const baseUrl = process.env['OPENAI_BASE_URL']?.replace(/\/+$/u, '');
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!baseUrl || !apiKey) {
      return c.json(
        createApiErrorBody(
          'runtime_unavailable',
          'Embeddings unavailable: OPENAI_BASE_URL and OPENAI_API_KEY required',
        ),
        503,
      );
    }

    const ports = await getWorkspaceContainerPorts(id).catch(() => null);
    if (!ports?.memory) {
      return c.json(createApiErrorBody('runtime_unavailable', 'Memory service not ready'), 503);
    }

    const memBase = `http://127.0.0.1:${ports.memory}`;
    type RawPattern = { id: string; revertSignature: string; patch: string };
    type RawPage = { patterns: RawPattern[] };

    const [localRes, meshRes] = await Promise.all([
      loopbackFetch(`${memBase}/patterns?scope=local&limit=200`),
      loopbackFetch(`${memBase}/patterns?scope=mesh&limit=200`),
    ]);
    const local = localRes.ok ? ((await localRes.json()) as RawPage).patterns : [];
    const mesh = meshRes.ok ? ((await meshRes.json()) as RawPage).patterns : [];
    const allPatterns = [...local, ...mesh];

    if (allPatterns.length === 0) {
      return c.json({ embeddings: [] }, 200);
    }

    const texts = allPatterns.map((p) => `${p.revertSignature}\n${p.patch.slice(0, 500)}`);
    const model = process.env['OPENAI_EMBED_MODEL'] ?? 'text-embedding-3-small';

    let embedResponse: Response;
    try {
      embedResponse = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      console.warn('[workspace] embeddings request failed:', err);
      return c.json(createApiErrorBody('runtime_unavailable', 'Embeddings request failed'), 503);
    }

    if (!embedResponse.ok) {
      const text = await embedResponse.text().catch(() => '');
      console.warn(`[workspace] embeddings API ${embedResponse.status}: ${text}`);
      return c.json(
        createApiErrorBody('runtime_unavailable', `Embeddings API error: ${embedResponse.status}`),
        503,
      );
    }

    const embedData = (await embedResponse.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    const embeddings = embedData.data.map((item) => ({
      id: allPatterns[item.index]!.id,
      vector: item.embedding,
    }));
    return c.json({ embeddings }, 200);
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

// ── Container-auth API ───────────────────────────────────────────────────────
// These routes are called by mcp-mesh processes running INSIDE workspace
// containers.  They are NOT protected by `requireSession` (no user session is
// available inside a container).  Instead they require an
// `X-Container-Secret` header that matches the `CRUCIBLE_RUNTIME_SECRET` env
// var shared between the host backend process and every container it spawns.
// If the operator has not set `CRUCIBLE_RUNTIME_SECRET` the routes return 401
// so the feature degrades gracefully rather than becoming an open API.

function requireContainerAuth(
  c: { req: { header: (k: string) => string | undefined } },
  next: () => Promise<Response | undefined>,
): Response | Promise<Response | undefined> {
  const secret = process.env['CRUCIBLE_RUNTIME_SECRET'];
  if (!secret) {
    return new Response(JSON.stringify({ error: 'container auth not configured' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const provided = c.req.header('x-container-secret');
  if (!provided || provided !== secret) {
    return new Response(JSON.stringify({ error: 'invalid container secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return next();
}

const containerApiBase = new OpenAPIHono();
// Scope the container-auth guard to ONLY the container-only endpoints. Using
// `'*'` here would intercept every request that falls through from earlier
// sub-apps mounted at `/api` (e.g. `/api/workspace/:id/rpc`, `/api/agent/*`)
// and return 401 "container auth not configured" in dev where
// CRUCIBLE_RUNTIME_SECRET is unset — masking the real route as unauthorized.
containerApiBase.use(
  '/workspace/:id/axl-key',
  requireContainerAuth as Parameters<typeof containerApiBase.use>[1],
);
containerApiBase.use(
  '/workspace/:id/mesh-peers',
  requireContainerAuth as Parameters<typeof containerApiBase.use>[1],
);

export const containerApi = containerApiBase
  .openapi(registerAxlKeyRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { axlPublicKey } = c.req.valid('json');

    // Ensure the workspace runtime row exists (container is running, so it should).
    const runtime = await prisma.workspaceRuntime.findUnique({ where: { workspaceId: id } });
    if (!runtime) {
      return c.json(createApiErrorBody('not_found', 'Workspace runtime not found'), 404);
    }

    await prisma.workspaceRuntime.update({
      where: { workspaceId: id },
      data: { axlPublicKey },
    });

    return c.json({ ok: true as const }, 200);
  })
  .openapi(getMeshPeersRoute, async (c) => {
    const { id } = c.req.valid('param');

    // Verify workspace exists
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!workspace) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    // Return all other workspaces belonging to the same user that have
    // registered an AXL public key.
    const peers = await prisma.workspaceRuntime.findMany({
      where: {
        workspace: { userId: workspace.userId },
        axlPublicKey: { not: null },
        NOT: { workspaceId: id },
      },
      select: { workspaceId: true, axlPublicKey: true },
    });

    return c.json(
      {
        peers: peers.map((p) => ({
          workspaceId: p.workspaceId as z.infer<typeof WorkspaceIdSchema>,
          axlPublicKey: p.axlPublicKey!,
        })),
      },
      200,
    );
  });
