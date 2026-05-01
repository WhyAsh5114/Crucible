import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { encodeBigInt, type mcp } from '@crucible/types';

const DEFAULT_LABELS = [
  'Account 1',
  'Account 2',
  'Account 3',
  'Account 4',
  'Account 5',
  'Account 6',
  'Account 7',
  'Account 8',
  'Account 9',
  'Account 10',
] as const;

interface RpcErrorShape {
  message?: string;
  data?: unknown;
}

interface RpcResponse<T> {
  result?: T;
  error?: RpcErrorShape;
}

interface StateShape {
  wallet?: {
    activeAccountLabel?: string;
  };
  [key: string]: unknown;
}

export interface WalletService {
  listAccounts: () => Promise<{
    accounts: Array<{ label: string; address: `0x${string}`; balance: string }>;
    activeAccountLabel: string | null;
  }>;
  getBalance: (input: mcp.wallet.GetBalanceInput) => Promise<{ balance: string }>;
  signTx: (input: mcp.wallet.SignTxInput) => Promise<{ signedTx: `0x${string}` }>;
  sendTxLocal: (input: mcp.wallet.SendTxLocalInput) => Promise<{
    txHash: `0x${string}`;
    gasUsed: string;
    status: 'success' | 'reverted';
  }>;
  switchAccount: (input: mcp.wallet.SwitchAccountInput) => Promise<{ active: `0x${string}` }>;
}

interface RpcReceipt {
  gasUsed: string;
  status: string;
}

async function rpc<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `JSON-RPC request failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
    );
  }

  let data: RpcResponse<T>;
  try {
    data = (await res.json()) as RpcResponse<T>;
  } catch (e) {
    throw new Error(`JSON-RPC (${method}) parse error: ${String(e)}`, { cause: e });
  }

  if (data.error) {
    throw new Error(`JSON-RPC error (${method}): ${data.error.message ?? 'Unknown error'}`);
  }

  return data.result as T;
}

function toHexQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function labelForIndex(index: number): string {
  return DEFAULT_LABELS[index] ?? `Account ${index + 1}`;
}

/** Builds the base RPC transaction object (for eth_sendTransaction). */
function txToSendObject(tx: mcp.wallet.SignTxInput['tx']): Record<string, unknown> {
  return {
    from: tx.from,
    to: tx.to,
    data: tx.data,
    ...(tx.value !== undefined ? { value: toHexQuantity(BigInt(tx.value)) } : {}),
    ...(tx.gas !== undefined ? { gas: toHexQuantity(BigInt(tx.gas)) } : {}),
    ...(tx.nonce !== undefined ? { nonce: `0x${tx.nonce.toString(16)}` } : {}),
  };
}

/** Alias for eth_signTransaction (includes same fields). */
const txToRpcObject = txToSendObject;

async function readStateFile(statePath: string): Promise<StateShape> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as StateShape;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeStateFile(statePath: string, state: StateShape): Promise<void> {
  await mkdir(join(statePath, '..'), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function waitForReceipt(
  chainRpcUrl: string,
  txHash: string,
  timeoutMs = 20_000,
): Promise<RpcReceipt> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await rpc<RpcReceipt | null>(chainRpcUrl, 'eth_getTransactionReceipt', [
      txHash,
    ]);
    if (receipt) return receipt;
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for receipt: ${txHash}`);
}

export function createWalletService(opts: {
  chainRpcUrl: string;
  workspaceRoot: string;
}): WalletService {
  const statePath = join(opts.workspaceRoot, '.crucible', 'state.json');

  return {
    async listAccounts() {
      const addresses = await rpc<string[]>(opts.chainRpcUrl, 'eth_accounts');
      const [balances, state] = await Promise.all([
        Promise.all(
          addresses.map((address) =>
            rpc<string>(opts.chainRpcUrl, 'eth_getBalance', [address, 'latest']),
          ),
        ),
        readStateFile(statePath),
      ]);

      return {
        accounts: addresses.map((address, idx) => ({
          label: labelForIndex(idx),
          address: address as `0x${string}`,
          balance: encodeBigInt(BigInt(balances[idx]!)),
        })),
        activeAccountLabel: state.wallet?.activeAccountLabel ?? DEFAULT_LABELS[0] ?? null,
      };
    },

    async getBalance({ address }) {
      const balanceHex = await rpc<string>(opts.chainRpcUrl, 'eth_getBalance', [address, 'latest']);
      return { balance: encodeBigInt(BigInt(balanceHex)) };
    },

    async signTx({ tx }) {
      const signedTx = await rpc<string>(opts.chainRpcUrl, 'eth_signTransaction', [
        txToRpcObject(tx),
      ]);
      return { signedTx: signedTx as `0x${string}` };
    },

    async sendTxLocal({ tx }) {
      // Hardhat test nodes don't support eth_signTransaction. Use eth_sendTransaction
      // directly — the node auto-signs with the unlocked account referenced by `from`.
      const txHash = await rpc<string>(opts.chainRpcUrl, 'eth_sendTransaction', [
        txToSendObject(tx),
      ]);
      const receipt = await waitForReceipt(opts.chainRpcUrl, txHash);

      return {
        txHash: txHash as `0x${string}`,
        gasUsed: encodeBigInt(BigInt(receipt.gasUsed)),
        status: receipt.status === '0x1' ? 'success' : 'reverted',
      };
    },

    async switchAccount({ label }) {
      const accounts = await this.listAccounts();
      const selected = accounts.accounts.find((entry) => entry.label === label);
      if (!selected) {
        throw new Error(`Unknown account label: ${label}`);
      }

      const state = await readStateFile(statePath);
      state.wallet = {
        ...(state.wallet ?? {}),
        activeAccountLabel: label,
      };
      await writeStateFile(statePath, state);

      return { active: selected.address };
    },
  };
}
