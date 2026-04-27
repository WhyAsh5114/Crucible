/**
 * 0G Compute inference adapter.
 *
 * Builds an `AgentConfig` that routes inference through a 0G Compute provider.
 * Returns `null` when the required environment variables are absent so callers
 * can fall back to the OpenAI-compatible path transparently.
 *
 * Required environment variables:
 *   OG_PROVIDER_ADDRESS  – Ethereum address of the 0G Compute provider
 *   OG_PRIVATE_KEY       – Hex private key of the wallet funding the account
 *
 * Optional:
 *   OG_RPC_URL           – EVM RPC URL (defaults to 0G testnet)
 */

import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import type { AgentConfig } from '@crucible/agent';

const OG_RPC_DEFAULT = 'https://evmrpc-testnet.0g.ai';

/**
 * Build an `AgentConfig` that routes inference through 0G Compute.
 *
 * Calls `getServiceMetadata` to discover the provider's endpoint and model,
 * then `getRequestHeaders` to generate per-request signed auth headers.
 * The Authorization Bearer token is extracted into `apiKey` so the AI SDK
 * sets it normally; remaining signed headers are passed via `config.headers`.
 *
 * Returns `null` when `OG_PROVIDER_ADDRESS` or `OG_PRIVATE_KEY` are not set.
 */
export async function buildOgAgentConfig(): Promise<AgentConfig | null> {
  const providerAddress = process.env['OG_PROVIDER_ADDRESS'];
  const privateKey = process.env['OG_PRIVATE_KEY'];
  if (!providerAddress || !privateKey) return null;

  const rpcUrl = process.env['OG_RPC_URL'] ?? OG_RPC_DEFAULT;

  const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, rpcProvider);
  const broker = await createZGComputeNetworkBroker(wallet);

  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);

  // Per-request signed headers include Authorization and 0G-specific fields.
  // ServingRequestHeaders has no index signature, so we cast through unknown.
  const rawHeaders = (await broker.inference.getRequestHeaders(
    providerAddress,
  )) as unknown as Record<string, string>;

  // Split Authorization from the rest so the AI SDK handles Bearer correctly.
  const authHeader = rawHeaders['Authorization'] ?? rawHeaders['authorization'] ?? '';
  const apiKey = authHeader.replace(/^Bearer\s+/iu, '');

  const extraHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (k.toLowerCase() !== 'authorization') {
      extraHeaders[k] = v;
    }
  }

  // With exactOptionalPropertyTypes we must omit the key entirely rather than
  // assign undefined to it.
  return {
    baseUrl: endpoint,
    apiKey,
    model,
    ...(Object.keys(extraHeaders).length > 0 ? { headers: extraHeaders } : {}),
    provider: '0g-compute' as const,
  };
}
