import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertContainedInWorkspace, createDeployerService } from '../src/service.ts';

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_C = '0x2222222222222222222222222222222222222222';
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mcp-deployer service', () => {
  let workspaceRoot = '';

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'crucible-mcp-deployer-test-'));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('assertContainedInWorkspace allows in-workspace paths and rejects outside paths', async () => {
    await expect(
      assertContainedInWorkspace(workspaceRoot, join(workspaceRoot, 'contracts', 'A.sol')),
    ).resolves.toBe('contracts/A.sol');

    await expect(assertContainedInWorkspace(workspaceRoot, '/etc/passwd')).rejects.toThrow(
      'path must resolve within the workspace root',
    );
  });

  it('deployLocal sends tx and returns address/hash/gas from receipt', async () => {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string;
      };

      switch (body.method) {
        case 'eth_accounts':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: [ADDRESS_A] });
        case 'eth_sendTransaction':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: TX_HASH });
        case 'eth_getTransactionReceipt':
          return jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transactionHash: TX_HASH,
              contractAddress: ADDRESS_C,
              gasUsed: '0x5208',
              status: '0x1',
              logs: [],
            },
          });
        default:
          return jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            error: { message: `unexpected method: ${body.method}` },
          });
      }
    }) as typeof fetch;

    const service = createDeployerService({ chainRpcUrl: 'http://rpc.local', workspaceRoot });

    const output = await service.deployLocal({
      bytecode: '0x60006000',
      constructorData: '0x',
    });

    expect(output.address).toBe(ADDRESS_C);
    expect(output.txHash).toBe(TX_HASH);
    expect(output.gasUsed).toBe('21000');
  });

  it('call forwards eth_call and returns raw hex result', async () => {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string;
      };

      if (body.method === 'eth_call') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: '0x00000000000000000000000000000001',
        });
      }

      return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: 'unexpected method' } });
    }) as typeof fetch;

    const service = createDeployerService({ chainRpcUrl: 'http://rpc.local', workspaceRoot });
    const output = await service.call({
      to: ADDRESS_A,
      data: '0x1234',
    });

    expect(output.result).toBe('0x00000000000000000000000000000001');
  });
});
