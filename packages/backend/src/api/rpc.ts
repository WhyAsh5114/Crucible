/**
 * POST /workspace/:id/rpc
 *
 * EIP-1193 bridge endpoint. The frontend shell calls this on behalf of the
 * preview iframe (which cannot reach the backend directly due to cross-origin
 * restrictions). The route:
 *
 *  1. Requires a valid session (enforced by requireSession middleware).
 *  2. Verifies the workspace is owned by the authenticated user.
 *  3. Validates the requested JSON-RPC method against ALLOWED_RPC_METHODS.
 *  4. Resolves eth_chainId from the DB (no container round-trip needed).
 *  5. Forwards all other methods to the workspace's mcp-chain /json-rpc
 *     endpoint running inside the Docker container.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  WorkspaceIdSchema,
  AllowedRpcMethodSchema,
  ApiErrorSchema,
  ChainStateSchema,
} from '@crucible/types';
import { prisma } from '../lib/prisma';
import { createApiErrorBody } from '../lib/api-error';
import { requireSession } from '../lib/auth';

type ApiVariables = { userId: string };

// ── Request / response schemas ───────────────────────────────────────────────

const RpcRequestBodySchema = z.object({
  method: AllowedRpcMethodSchema,
  params: z.array(z.unknown()).default([]),
});

const RpcSuccessSchema = z.object({ result: z.unknown() });
const RpcErrorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
  }),
});
const RpcResponseSchema = z.union([RpcSuccessSchema, RpcErrorSchema]);

// ── OpenAPI route ────────────────────────────────────────────────────────────

const rpcRoute = createRoute({
  method: 'post',
  path: '/workspace/{id}/rpc',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    body: {
      content: { 'application/json': { schema: RpcRequestBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RpcResponseSchema } },
      description: 'JSON-RPC result or error',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Disallowed or malformed method',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace not found',
    },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Chain container not running',
    },
  },
});

// ── Router ───────────────────────────────────────────────────────────────────

const rpcApiBase = new OpenAPIHono<{ Variables: ApiVariables }>({
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

rpcApiBase.use('*', requireSession);

export const rpcApi = rpcApiBase.openapi(rpcRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { method, params } = c.req.valid('json');
  const userId = c.get('userId');

  // Ownership check — treat foreign workspaces as 404 to avoid leaking IDs.
  const row = await prisma.workspace.findUnique({
    where: { id },
    include: { runtime: true },
  });
  if (!row || row.userId !== userId) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  // Fast-path: eth_chainId is always available in the DB chainState (set when
  // the chain container reports ready) and never changes for a local node.
  if (method === 'eth_chainId') {
    const chainState = ChainStateSchema.safeParse(row.runtime?.chainState);
    const chainId = chainState.success ? `0x${chainState.data.chainId.toString(16)}` : '0x7a69'; // 31337 — Hardhat default; returned as best-effort before first state sync
    return c.json({ result: chainId }, 200);
  }

  // Fast-path: eth_accounts / eth_requestAccounts — the funded accounts are
  // stored in chainState when the container first reports ready. Return them
  // directly so wallet connect works even when the container is not running.
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
    const chainState = ChainStateSchema.safeParse(row.runtime?.chainState);
    const accounts = chainState.success ? chainState.data.accounts : [];
    return c.json({ result: accounts }, 200);
  }

  // All other methods: forward to the mcp-chain /json-rpc endpoint running
  // inside the workspace's Docker container.
  const chainPort = row.runtime?.chainPort;
  if (!chainPort) {
    return c.json(createApiErrorBody('runtime_unavailable', 'Chain container is not running'), 503);
  }

  const chainUrl = `http://127.0.0.1:${chainPort}/json-rpc`;
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(chainUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    });
  } catch (err) {
    console.error(`[rpc ${id}] chain fetch failed: ${String(err)}`);
    return c.json(createApiErrorBody('runtime_unavailable', 'Chain container is unreachable'), 503);
  }

  const data = (await upstreamRes.json()) as
    | { result: unknown }
    | { error: { code: number; message: string } };

  return c.json(data, 200);
});
