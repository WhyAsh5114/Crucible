/**
 * Integration tests for the mcp-chain /json-rpc endpoint.
 *
 * Tests exercise the allowlist validation, auto-start behavior, and
 * successful read/write calls against a live Hardhat node.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/index.ts';
import { startNode, stopNode, requireNode } from '../src/node-manager.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function post(body: unknown): Promise<Response> {
  return app.request('/json-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

// ── Allowlist validation (no node required) ───────────────────────────────────

describe('/json-rpc — allowlist validation', () => {
  it('returns 400 for a hardhat_ method', async () => {
    const res = await post({ method: 'hardhat_impersonateAccount', params: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(4200);
  });

  it('returns 400 for a debug_ method', async () => {
    const res = await post({ method: 'debug_traceTransaction', params: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(4200);
  });

  it('returns 400 for a missing method field', async () => {
    const res = await post({ params: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-JSON body', async () => {
    const res = await app.request('/json-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});

// ── Auto-start when no node is running ───────────────────────────────────────

describe('/json-rpc — auto-starts when no node is running', () => {
  it('auto-starts the node and returns a valid result for eth_chainId', async () => {
    // The /json-rpc endpoint starts the node automatically on first request if
    // none is running — 503 is only returned if startNode itself throws.
    // This test relies on no node being started yet (runs before "Live Hardhat calls").
    const res = await post({ method: 'eth_chainId', params: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe('0x7a69');
  });
});

// ── Live Hardhat calls ────────────────────────────────────────────────────────

describe('/json-rpc — live Hardhat calls', () => {
  beforeAll(async () => {
    // Override the module-level WORKSPACE_ID by starting a node with the same
    // id that index.ts uses ('default' unless WORKSPACE_ID env is set).
    const wsId = process.env['WORKSPACE_ID'] ?? 'default';
    await startNode(wsId, {});
  });

  afterAll(async () => {
    const wsId = process.env['WORKSPACE_ID'] ?? 'default';
    await stopNode(wsId);
  });

  it('eth_chainId returns 0x7a69 (31337)', async () => {
    const res = await post({ method: 'eth_chainId', params: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe('0x7a69');
  });

  it('eth_accounts returns at least one pre-funded address', async () => {
    const res = await post({ method: 'eth_accounts', params: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string[] };
    expect(Array.isArray(body.result)).toBe(true);
    expect(body.result.length).toBeGreaterThan(0);
    expect(body.result[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('eth_blockNumber returns a hex-encoded number', async () => {
    const res = await post({ method: 'eth_blockNumber', params: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it('eth_call with a well-formed call returns a result', async () => {
    const wsId = process.env['WORKSPACE_ID'] ?? 'default';
    const { accounts } = requireNode(wsId);
    const res = await post({
      method: 'eth_call',
      params: [{ from: accounts[0], to: accounts[1], data: '0x', value: '0x0' }, 'latest'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    // A plain ETH call with no code returns the empty hex string
    expect(typeof body.result).toBe('string');
  });

  it('eth_sendTransaction sends a transaction and returns a hash', async () => {
    const wsId = process.env['WORKSPACE_ID'] ?? 'default';
    const { accounts } = requireNode(wsId);
    const res = await post({
      method: 'eth_sendTransaction',
      params: [{ from: accounts[0], to: accounts[1], value: '0x1' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('params defaults to [] when omitted', async () => {
    const res = await post({ method: 'eth_chainId' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe('0x7a69');
  });
});
