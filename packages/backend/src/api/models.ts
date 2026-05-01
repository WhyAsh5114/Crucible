/**
 * Models router — `GET /api/models`.
 *
 * Returns the available inference providers and their models so the frontend
 * can populate the model picker without exposing API keys to the client.
 *
 * Response shape:
 *   - `og`     — the 0G Compute Router model (null when unconfigured)
 *   - `openai` — list of model IDs from the OpenAI-compatible endpoint
 *                (null when unconfigured, empty array when the fetch fails)
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { buildOgAgentConfig } from '../lib/og-adapter';

const ModelsResponseSchema = z.object({
  og: z.object({ model: z.string() }).nullable(),
  openai: z.array(z.string()).nullable(),
});

const modelsRoute = createRoute({
  method: 'get',
  path: '/models',
  responses: {
    200: {
      content: { 'application/json': { schema: ModelsResponseSchema } },
      description: 'Available inference models',
    },
  },
});

export const modelsApi = new OpenAPIHono().openapi(modelsRoute, async (c) => {
  const og = buildOgAgentConfig();

  let openaiModels: string[] | null = null;
  const baseUrl = process.env['OPENAI_BASE_URL'];
  const apiKey = process.env['OPENAI_API_KEY'];
  if (baseUrl && apiKey) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/u, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        openaiModels = (data.data ?? []).map((m) => m.id).sort();
      } else {
        openaiModels = [];
      }
    } catch {
      openaiModels = [];
    }
  }

  return c.json({
    og: og ? { model: og.model } : null,
    openai: openaiModels,
  });
});
