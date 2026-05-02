import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { encodeBigInt, type mcp } from '@crucible/types';
import {
  toFunctionSelector,
  parseAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  decodeFunctionResult,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
} from 'viem';

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
  encodeCall: (input: mcp.wallet.EncodeCallInput) => Promise<{ calldata: `0x${string}` }>;
  callContract: (input: mcp.wallet.CallContractInput) => Promise<mcp.wallet.CallContractOutput>;
  readContract: (input: mcp.wallet.ReadContractInput) => Promise<mcp.wallet.ReadContractOutput>;
  sendValue: (input: mcp.wallet.SendValueInput) => Promise<mcp.wallet.SendValueOutput>;
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

/**
 * Normalise a Solidity function signature to its canonical form used as the
 * input to keccak256 for the 4-byte selector. Strips parameter names, e.g.
 * "withdraw(uint256 amount)" → "withdraw(uint256)".
 */
function canonicaliseSignature(sig: string): string {
  const normalized = sig.trim().replace(/^function\s+/, '');
  const parenOpen = normalized.indexOf('(');
  if (parenOpen < 0) return normalized;
  const funcName = normalized.slice(0, parenOpen).trim();
  const paramsRaw = normalized.slice(parenOpen + 1, normalized.lastIndexOf(')'));
  const canonicalParams = paramsRaw
    .split(',')
    .map((p) => p.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)
    .join(',');
  return `${funcName}(${canonicalParams})`;
}

/** Decode a `Error(string)` revert payload, if applicable. */
function decodeRevertReason(data: string | undefined): string | undefined {
  if (!data || !data.startsWith('0x')) return undefined;
  const clean = data.slice(2);
  if (!clean.startsWith('08c379a0')) return undefined;
  if (clean.length < 8 + 64 + 64) return undefined;
  try {
    const lengthHex = clean.slice(8 + 64, 8 + 128);
    const length = parseInt(lengthHex, 16);
    const dataHex = clean.slice(8 + 128, 8 + 128 + length * 2);
    return Buffer.from(dataHex, 'hex').toString('utf8');
  } catch {
    return undefined;
  }
}

export function createWalletService(opts: {
  chainRpcUrl: string;
  workspaceRoot: string;
  /** mcp-compiler base URL (e.g. http://localhost:3101) — used for ABI lookup. */
  compilerUrl?: string;
  /** mcp-deployer base URL (e.g. http://localhost:3102) — used for address lookup by contract name. */
  deployerUrl?: string;
}): WalletService {
  const statePath = join(opts.workspaceRoot, '.crucible', 'state.json');
  const compilerUrl = opts.compilerUrl ?? 'http://localhost:3101';
  const deployerUrl = opts.deployerUrl ?? 'http://localhost:3102';

  /** Resolve a contract reference (name and/or explicit address) to (abi, address). */
  async function resolveContract(
    ref: mcp.wallet.CallContractInput['contract'],
  ): Promise<{ address: `0x${string}`; abi: Abi }> {
    let address = ref.address as `0x${string}` | undefined;
    let abi: Abi | undefined;

    if (ref.contractName) {
      // Fetch ABI from compiler.
      const abiRes = await fetch(`${compilerUrl}/abi/${ref.contractName}`);
      if (!abiRes.ok) {
        if (abiRes.status === 404) {
          throw new Error(
            `Contract "${ref.contractName}" not found in artifact store — compile it first (compiler.compile).`,
          );
        }
        throw new Error(`Failed to fetch ABI: ${abiRes.status} ${await abiRes.text()}`);
      }
      const abiData = (await abiRes.json()) as { abi?: Abi };
      if (!abiData.abi) {
        throw new Error(`Compiler returned no ABI for "${ref.contractName}"`);
      }
      abi = abiData.abi;

      if (!address) {
        // Resolve the address from the deployer registry.
        const addrRes = await fetch(`${deployerUrl}/deployments/${ref.contractName}`);
        if (!addrRes.ok) {
          throw new Error(
            `No deployment recorded for "${ref.contractName}" — deploy it first (deployer.deploy_local) or pass the address explicitly.`,
          );
        }
        const record = (await addrRes.json()) as { address?: `0x${string}` };
        if (!record.address) {
          throw new Error(`Deployer returned no address for "${ref.contractName}"`);
        }
        address = record.address;
      }
    }

    if (!address) {
      throw new Error('Could not resolve contract address — provide contractName or address.');
    }
    if (!abi) {
      throw new Error('Could not resolve contract ABI — provide a contractName.');
    }

    return { address, abi };
  }

  /**
   * Find an ABI function by name or by full canonical signature. If only a name
   * is given and there are multiple overloads, throws a helpful error.
   */
  function pickAbiFunction(abi: Abi, fn: string): AbiFunction {
    const trimmed = fn.trim().replace(/^function\s+/, '');
    const isSig = trimmed.includes('(');
    const fnItems = abi.filter(
      (item): item is AbiFunction => (item as AbiFunction).type === 'function',
    );
    if (isSig) {
      // Match canonical signature.
      const target = canonicaliseSignature(trimmed);
      const match = fnItems.find((item) => toFunctionSignature(item) === target);
      if (!match) {
        throw new Error(
          `No ABI function matching "${trimmed}". Available: ${fnItems.map((i) => toFunctionSignature(i)).join(', ')}`,
        );
      }
      return match;
    }
    const matches = fnItems.filter((item) => item.name === trimmed);
    if (matches.length === 0) {
      throw new Error(
        `No ABI function named "${trimmed}". Available: ${fnItems.map((i) => toFunctionSignature(i)).join(', ')}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous function name "${trimmed}" — pass the full signature instead. Overloads: ${matches.map((i) => toFunctionSignature(i)).join(', ')}`,
      );
    }
    return matches[0]!;
  }

  /** Convert string args to the JS types viem expects for the given ABI inputs. */
  function coerceArgs(fn: AbiFunction, args: readonly string[]): unknown[] {
    return fn.inputs.map((param, i) => {
      const raw = args[i] ?? '0';
      const t = param.type;
      if (/^u?int/.test(t)) return BigInt(raw);
      if (t === 'bool') return raw === 'true' || raw === '1';
      if (t.endsWith('[]')) {
        // Permit JSON array inputs for array params.
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    });
  }

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
      const currentLabel = state.wallet?.activeAccountLabel ?? DEFAULT_LABELS[0];
      if (currentLabel === label) {
        // Already active — skip the write and return immediately.
        return { active: selected.address };
      }

      state.wallet = {
        ...(state.wallet ?? {}),
        activeAccountLabel: label,
      };
      await writeStateFile(statePath, state);

      return { active: selected.address };
    },

    async encodeCall({ signature, args }) {
      // Normalise: strip leading "function " if the caller included it.
      const normalized = signature.trim().replace(/^function\s+/, '');
      // Extract just the canonical form for the selector: strip parameter names,
      // e.g. "withdraw(uint256 amount)" → "withdraw(uint256)".
      const parenOpen = normalized.indexOf('(');
      const funcName = normalized.slice(0, parenOpen).trim();
      const paramsRaw = normalized.slice(parenOpen + 1, normalized.lastIndexOf(')'));

      // Strip parameter names: "uint256 amount, address to" → "uint256,address"
      const canonicalParams = paramsRaw
        .split(',')
        .map((p) => p.trim().split(/\s+/)[0] ?? '')
        .join(',');
      const canonicalSig = `${funcName}(${canonicalParams})`;

      // Compute 4-byte selector.
      const selector = toFunctionSelector(canonicalSig);

      if (!canonicalParams || args.length === 0) {
        return { calldata: selector as `0x${string}` };
      }

      // Parse parameter types and convert string args to the types viem expects.
      const abiParams = parseAbiParameters(canonicalParams);
      const typedArgs: unknown[] = abiParams.map((param, i) => {
        const raw = args[i] ?? '0';
        if (/^u?int/.test(param.type)) return BigInt(raw);
        if (param.type === 'bool') return raw === 'true' || raw === '1';
        return raw; // address, bytes*, string — pass as-is
      });

      const encoded = encodeAbiParameters(abiParams, typedArgs);
      const calldata = (selector + encoded.slice(2)) as `0x${string}`;
      return { calldata };
    },

    async callContract(input) {
      const { address, abi } = await resolveContract(input.contract);
      const fn = pickAbiFunction(abi, input.function);
      const signature = toFunctionSignature(fn);
      const args = coerceArgs(fn, input.args ?? []);
      const data = encodeFunctionData({ abi, functionName: fn.name, args });

      const from = input.from ?? (await rpc<string[]>(opts.chainRpcUrl, 'eth_accounts')).at(0);
      if (!from) {
        throw new Error('No sender available — pass `from` or ensure local accounts are unlocked.');
      }

      const txObject: Record<string, unknown> = {
        from,
        to: address,
        data,
        ...(input.value !== undefined ? { value: toHexQuantity(BigInt(input.value)) } : {}),
        ...(input.gas !== undefined ? { gas: toHexQuantity(BigInt(input.gas)) } : {}),
      };

      let txHash: string;
      try {
        txHash = await rpc<string>(opts.chainRpcUrl, 'eth_sendTransaction', [txObject]);
      } catch (err) {
        // Hardhat rejects guaranteed-revert txs before mining. Surface the
        // revert reason so the agent's repair loop can pick it up.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`call_contract reverted (${signature} on ${address}): ${message}`, {
          cause: err,
        });
      }
      const receipt = await waitForReceipt(opts.chainRpcUrl, txHash);
      const status = receipt.status === '0x1' ? 'success' : 'reverted';

      let revertReason: string | undefined;
      if (status === 'reverted') {
        // Re-run as eth_call against the prior block to get the revert payload.
        try {
          await rpc(opts.chainRpcUrl, 'eth_call', [txObject, 'latest']);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          revertReason = decodeRevertReason(extractDataField(err)) ?? message;
        }
      }

      return {
        txHash: txHash as `0x${string}`,
        gasUsed: encodeBigInt(BigInt(receipt.gasUsed)),
        status,
        address: address,
        signature,
        ...(revertReason ? { revertReason } : {}),
      };
    },

    async readContract(input) {
      const { address, abi } = await resolveContract(input.contract);
      const fn = pickAbiFunction(abi, input.function);
      const signature = toFunctionSignature(fn);
      const args = coerceArgs(fn, input.args ?? []);
      const data = encodeFunctionData({ abi, functionName: fn.name, args });

      const callObject: Record<string, unknown> = {
        to: address,
        data,
        ...(input.from ? { from: input.from } : {}),
      };

      const raw = await rpc<string>(opts.chainRpcUrl, 'eth_call', [callObject, 'latest']);
      let result: unknown = raw;
      try {
        const decoded = decodeFunctionResult({
          abi,
          functionName: fn.name,
          data: raw as `0x${string}`,
        });
        // viem returns either a single value (single-output) or an array (multi-output).
        // We pass it through as-is; bigint values will be JSON-serialised by the caller.
        result = sanitiseResult(decoded);
      } catch {
        // If decoding fails, fall back to the raw hex.
      }

      return {
        result,
        raw: raw as `0x${string}`,
        address,
        signature,
      };
    },

    async sendValue(input) {
      const from = input.from ?? (await rpc<string[]>(opts.chainRpcUrl, 'eth_accounts')).at(0);
      if (!from) {
        throw new Error('No sender available — pass `from` or ensure local accounts are unlocked.');
      }
      const txObject = {
        from,
        to: input.to,
        value: toHexQuantity(BigInt(input.value)),
      };
      const txHash = await rpc<string>(opts.chainRpcUrl, 'eth_sendTransaction', [txObject]);
      const receipt = await waitForReceipt(opts.chainRpcUrl, txHash);
      return {
        txHash: txHash as `0x${string}`,
        gasUsed: encodeBigInt(BigInt(receipt.gasUsed)),
        status: receipt.status === '0x1' ? 'success' : 'reverted',
      };
    },
  };
}

/** Recursively convert bigints to decimal strings so the result can be JSON-encoded by the MCP layer. */
function sanitiseResult(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sanitiseResult);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitiseResult(v);
    return out;
  }
  return value;
}

function extractDataField(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { data?: unknown; cause?: unknown };
  if (typeof e.data === 'string') return e.data;
  if (e.data && typeof e.data === 'object') {
    const inner = (e.data as { data?: unknown }).data;
    if (typeof inner === 'string') return inner;
  }
  if (e.cause) return extractDataField(e.cause);
  return undefined;
}
