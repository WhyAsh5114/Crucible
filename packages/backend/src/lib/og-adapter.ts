/**
 * 0G Compute Router inference adapter.
 *
 * Builds an `AgentConfig` that routes inference through the 0G Compute Router
 * — a single OpenAI-compatible endpoint with unified billing, automatic
 * provider failover, and verifiable execution receipts (`x_0g_trace`).
 *
 * See: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview
 *
 * Returns `null` when the required environment variables are absent so callers
 * can fall back to the OpenAI-compatible path transparently.
 *
 * Required environment variables:
 *   OG_API_KEY  – `sk-...` from pc.testnet.0g.ai (testnet) or pc.0g.ai (mainnet)
 *   OG_MODEL    – Model id, e.g. `zai-org/GLM-5-FP8`
 *
 * Optional:
 *   OG_ROUTER_URL – Router base URL. Defaults to the testnet endpoint.
 */

import type { AgentConfig } from '@crucible/agent';

/**
 * Default Router base URL — the testnet endpoint.
 *
 * Mainnet (`https://router-api.0g.ai/v1`) and testnet are fully separate
 * environments with different API keys and on-chain balances.
 */
const OG_ROUTER_DEFAULT_URL = 'https://router-api-testnet.integratenetwork.work/v1';

/**
 * Build an `AgentConfig` that routes inference through the 0G Compute Router.
 *
 * Returns `null` when `OG_API_KEY` or `OG_MODEL` are not set so the inference
 * router can fall back to the OpenAI-compatible endpoint.
 */
export function buildOgAgentConfig(): AgentConfig | null {
  const apiKey = process.env['OG_API_KEY'];
  const model = process.env['OG_MODEL'];
  if (!apiKey || !model) return null;

  const baseUrl = (process.env['OG_ROUTER_URL'] ?? OG_ROUTER_DEFAULT_URL).replace(/\/+$/u, '');

  return {
    baseUrl,
    apiKey,
    model,
    provider: '0g-compute' as const,
  };
}
