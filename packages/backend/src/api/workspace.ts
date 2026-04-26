import {
  workspaceHostPath,
  collectWorkspaceFiles,
  provisionWorkspaceDirectory,
} from '../lib/workspace-fs';
import {
  ChainStateSchema,
  WorkspaceIdSchema,
  DeploymentRecordSchema,
  WorkspaceGetResponseSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceCreateResponseSchema,
} from '@crucible/types';
import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { createApiErrorBody } from '../lib/api-error';

export const workspaceApi = new Hono();

workspaceApi.post('/workspace', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsedBody = WorkspaceCreateRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return c.json(createApiErrorBody('bad_request', 'Invalid workspace create payload'), 400);
  }

  let createdId: string | null = null;

  try {
    const created = await prisma.workspace.create({
      data: {
        deployments: [],
        name: parsedBody.data.name,
        directoryPath: `pending://${randomUUID()}`,
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
});

workspaceApi.get('/workspace/:id', async (c) => {
  const id = c.req.param('id');
  const parsedId = WorkspaceIdSchema.safeParse(id);

  if (!parsedId.success) {
    return c.json(createApiErrorBody('bad_request', 'Invalid workspace id'), 400);
  }

  const row = await prisma.workspace.findUnique({
    where: { id: parsedId.data },
    include: { runtime: true },
  });

  if (!row) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  const chainState = ChainStateSchema.safeParse(row.chainState);
  const deployments = DeploymentRecordSchema.array().safeParse(row.deployments);
  const files = await collectWorkspaceFiles(row.directoryPath || workspaceHostPath(row.id));

  const response = WorkspaceGetResponseSchema.parse({
    files,
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.getTime(),
    previewUrl: row.runtime?.previewUrl ?? null,
    chainState: chainState.success ? chainState.data : null,
    deployments: deployments.success ? deployments.data : [],
    terminalSessionId: row.runtime?.terminalSessionId ?? null,
  });

  return c.json(response, 200);
});
