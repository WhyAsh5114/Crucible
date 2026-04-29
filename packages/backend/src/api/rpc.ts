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
import { WorkspaceIdSchema, AllowedRpcMethodSchema, ApiErrorSchema } from '@crucible/types';
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
    select: { userId: true, runtime: { select: { chainPort: true, chainState: true } } },
  });
  if (!row || row.userId !== userId) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  // Fast-path: eth_chainId is served directly from DB chainState — no container
  // round-trip needed. Falls back to Hardhat's well-known chain ID (31337) when
  // chainState is null (node not yet started).
  if (method === 'eth_chainId') {
    const chainState = row.runtime?.chainState as { chainId?: number } | null;
    const chainId = chainState?.chainId ?? 31337;
    return c.json({ result: `0x${chainId.toString(16)}` }, 200);
  }

  // All other methods are proxied to the mcp-chain /json-rpc endpoint.
  // mcp-chain owns the Hardhat node lifecycle (including auto-start).
  const chainPort = row.runtime?.chainPort;
  if (!chainPort) {
    return c.json(createApiErrorBody('runtime_unavailable', 'Chain container is not running'), 503);
  }

  const chainUrl = `http://127.0.0.1:${chainPort}/json-rpc`;
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(chainUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Host: 'localhost' },
      body: JSON.stringify({ method, params }),
    });
  } catch (err) {
    console.error(`[rpc ${id}] chain fetch failed: ${String(err)}`);
    return c.json(createApiErrorBody('runtime_unavailable', 'Chain container is unreachable'), 503);
  }

  let data: { result: unknown } | { error: { code: number; message: string } };
  try {
    data = (await upstreamRes.json()) as typeof data;
  } catch {
    // mcp-chain returned a non-JSON body (e.g. unhandled panic).
    return c.json(
      createApiErrorBody(
        'runtime_unavailable',
        `Chain returned non-JSON response (HTTP ${upstreamRes.status})`,
      ),
      503,
    );
  }

  return c.json(data, 200);
});
