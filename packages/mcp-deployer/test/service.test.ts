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
    globalThis.fetch = (async (url, init) => {
      // Compiler bytecode endpoint
      if (typeof url === 'string' && url.includes('/bytecode/')) {
        return jsonResponse({ bytecode: '0x60006000' });
      }

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

    const service = createDeployerService({
      chainRpcUrl: 'http://rpc.local',
      workspaceRoot,
      compilerUrl: 'http://compiler.local',
    });

    const output = await service.deployLocal({
      contractName: 'Counter',
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

  it('deploy0gChain throws when OG_DEPLOY_PRIVATE_KEY is absent', async () => {
    const service = createDeployerService({ chainRpcUrl: 'http://rpc.local', workspaceRoot });
    await expect(
      service.deploy0gChain({ contractName: 'Counter', constructorData: '0x' }),
    ).rejects.toThrow('OG_DEPLOY_PRIVATE_KEY is not set');
  });

  it('deploy0gChain sends tx and returns address/hash/explorer URL', async () => {
    // Minimal funded test private key (not used in any real deployment).
    const testPrivKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const CONTRACT_ADDRESS = '0x3333333333333333333333333333333333333333';

    globalThis.fetch = (async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

      // Compiler bytecode endpoint
      if (urlStr.includes('/bytecode/')) {
        return jsonResponse({ bytecode: '0x6000' });
      }

      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };

      switch (body.method) {
        case 'eth_chainId':
          // 16602 = 0x40DA
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x40da' });
        case 'eth_getTransactionCount':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x0' });
        case 'eth_gasPrice':
        case 'eth_maxPriorityFeePerGas':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x3b9aca00' });
        case 'eth_estimateGas':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x5208' });
        case 'eth_sendRawTransaction':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: TX_HASH });
        case 'eth_getTransactionReceipt':
          return jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transactionHash: TX_HASH,
              contractAddress: CONTRACT_ADDRESS,
              gasUsed: '0x5208',
              status: '0x1',
              logs: [],
              blockHash: '0x' + 'ab'.repeat(32),
              blockNumber: '0x1',
              cumulativeGasUsed: '0x5208',
              effectiveGasPrice: '0x3b9aca00',
              type: '0x2',
            },
          });
        case 'eth_getBlockByHash':
        case 'eth_getBlockByNumber':
          return jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              hash: '0x' + 'ab'.repeat(32),
              number: '0x1',
              parentHash: '0x' + '00'.repeat(32),
              timestamp: '0x6700',
              gasLimit: '0x1c9c380',
              gasUsed: '0x5208',
              transactions: [],
              miner: '0x' + '00'.repeat(20),
              difficulty: '0x0',
              totalDifficulty: '0x0',
              size: '0x0',
              extraData: '0x',
              logsBloom: '0x' + '00'.repeat(256),
              receiptsRoot: '0x' + '00'.repeat(32),
              stateRoot: '0x' + '00'.repeat(32),
              transactionsRoot: '0x' + '00'.repeat(32),
              nonce: '0x0000000000000000',
              sha3Uncles: '0x' + '00'.repeat(32),
              uncles: [],
              baseFeePerGas: '0x0',
            },
          });
        default:
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: null });
      }
    }) as typeof fetch;

    const service = createDeployerService({
      chainRpcUrl: 'http://rpc.local',
      workspaceRoot,
      compilerUrl: 'http://compiler.local',
      ogDeployPrivateKey: testPrivKey,
    });

    const output = await service.deploy0gChain({
      contractName: 'Counter',
      constructorData: '0x',
    });

    expect(output.address).toBe(CONTRACT_ADDRESS);
    expect(output.txHash).toBe(TX_HASH);
    expect(output.chainId).toBe(16602);
    expect(output.explorerUrl).toContain('chainscan-galileo.0g.ai');
    expect(output.explorerUrl).toContain(TX_HASH);
  });
});
