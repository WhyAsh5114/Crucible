import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWalletService } from '../src/service.ts';

const ADDRESS_1 = '0x1111111111111111111111111111111111111111';
const ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const TX_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SIGNED_TX = '0x1234abcd';

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mcp-wallet service', () => {
  let workspaceRoot = '';

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'crucible-mcp-wallet-test-'));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('listAccounts returns labeled accounts with decoded balances', async () => {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string;
        params?: unknown[];
      };
      switch (body.method) {
        case 'eth_accounts':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: [ADDRESS_1, ADDRESS_2] });
        case 'eth_getBalance': {
          const address = String(body.params?.[0] ?? '');
          return jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            result: address === ADDRESS_1 ? '0x1' : '0x2',
          });
        }
        default:
          return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: 'unexpected method' } });
      }
    }) as typeof fetch;

    const service = createWalletService({ chainRpcUrl: 'http://rpc.local', workspaceRoot });
    const result = await service.listAccounts();

    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]?.label).toBe('Account 1');
    expect(result.accounts[1]?.label).toBe('Account 2');
    expect(result.accounts[0]?.balance).toBe('1');
    expect(result.accounts[1]?.balance).toBe('2');
  });

  it('sendTxLocal signs, broadcasts, and returns receipt-derived status', async () => {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };

      switch (body.method) {
        case 'eth_signTransaction':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: SIGNED_TX });
        case 'eth_sendRawTransaction':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: TX_HASH });
        case 'eth_getTransactionReceipt':
          return jsonResponse({
            jsonrpc: '2.0',
            id: 1,
            result: {
              gasUsed: '0x5208',
              status: '0x1',
            },
          });
        default:
          return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: 'unexpected method' } });
      }
    }) as typeof fetch;

    const service = createWalletService({ chainRpcUrl: 'http://rpc.local', workspaceRoot });
    const out = await service.sendTxLocal({
      tx: {
        from: ADDRESS_1,
        to: ADDRESS_2,
        data: '0x',
        chainId: 31337,
      },
    });

    expect(out.txHash).toBe(TX_HASH);
    expect(out.gasUsed).toBe('21000');
    expect(out.status).toBe('success');
  });

  it('switchAccount persists activeAccountLabel in .crucible/state.json', async () => {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string;
        params?: unknown[];
      };

      switch (body.method) {
        case 'eth_accounts':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: [ADDRESS_1, ADDRESS_2] });
        case 'eth_getBalance':
          return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' });
        default:
          return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: 'unexpected method' } });
      }
    }) as typeof fetch;

    const service = createWalletService({ chainRpcUrl: 'http://rpc.local', workspaceRoot });
    const switched = await service.switchAccount({ label: 'Account 2' });
    expect(switched.active).toBe(ADDRESS_2);

    const statePath = join(workspaceRoot, '.crucible', 'state.json');
    const raw = await readFile(statePath, 'utf8');
    const state = JSON.parse(raw) as { wallet?: { activeAccountLabel?: string } };
    expect(state.wallet?.activeAccountLabel).toBe('Account 2');
  });
});
