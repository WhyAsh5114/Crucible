import { isAbsolute, relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import { encodeBigInt, type mcp } from '@crucible/types';

interface RpcErrorShape {
  message?: string;
  data?: unknown;
}

interface RpcResponse<T> {
  result?: T;
  error?: RpcErrorShape;
}

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

interface RpcReceipt {
  transactionHash: string;
  contractAddress: string | null;
  gasUsed: string;
  status: string;
  logs: RpcLog[];
}

interface RpcCallFrame {
  type?: string;
  from?: string;
  to?: string;
  input?: string;
  output?: string;
  error?: string;
  revertReason?: string;
  calls?: RpcCallFrame[];
}

interface RpcTraceResult {
  gas?: number;
  returnValue?: string;
  failed?: boolean;
  revertReason?: string;
  structLogs?: Array<{ op?: string; depth?: number; stack?: string[]; memory?: string[] }>;
}

export interface DeployerService {
  deployLocal: (input: mcp.deployer.DeployLocalInput) => Promise<{
    address: `0x${string}`;
    txHash: `0x${string}`;
    gasUsed: string;
  }>;
  simulateLocal: (input: mcp.deployer.SimulateLocalInput) => Promise<{
    result: `0x${string}`;
    gasEstimate: string;
    revertReason?: string;
    logs: Array<{
      address: `0x${string}`;
      topics: Array<`0x${string}`>;
      data: `0x${string}`;
    }>;
  }>;
  trace: (input: mcp.deployer.TraceInput) => Promise<{
    txHash: `0x${string}`;
    decodedCalls: mcp.deployer.TraceOutput['decodedCalls'];
    storageReads: mcp.deployer.TraceOutput['storageReads'];
    storageWrites: mcp.deployer.TraceOutput['storageWrites'];
    events: mcp.deployer.TraceOutput['events'];
    revertReason?: string;
    gasUsed: string;
  }>;
  call: (input: mcp.deployer.CallInput) => Promise<{ result: `0x${string}` }>;
}

/**
 * Resolve symlinks on both paths and verify `candidatePath` is contained
 * within `workspaceRoot`. Returns the workspace-relative path on success.
 */
export async function assertContainedInWorkspace(
  workspaceRoot: string,
  candidatePath: string,
): Promise<string> {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(workspaceRoot),
    realpath(candidatePath).catch(() => candidatePath),
  ]);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path must resolve within the workspace root');
  }
  return rel;
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
    const detail = extractRpcErrorDetail(data.error.data);
    throw new Error(
      `JSON-RPC error (${method}): ${data.error.message ?? 'Unknown error'}${detail ? ` — ${detail}` : ''}`,
    );
  }

  return data.result as T;
}

async function rpcWithError<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<{ result?: T; error?: RpcErrorShape }> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      error: {
        message: `HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
      },
    };
  }

  try {
    return (await res.json()) as { result?: T; error?: RpcErrorShape };
  } catch (e) {
    return {
      error: { message: `Parse error: ${String(e)}` },
    };
  }
}

function toHexQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function decodeRevertReasonFromData(data: string | undefined): string | undefined {
  if (!data || !data.startsWith('0x')) return undefined;
  const clean = data.slice(2);
  if (!clean.startsWith('08c379a0')) return undefined;
  if (clean.length < 8 + 64 + 64) return undefined;

  try {
    const lengthOffset = 8 + 64;
    const strLenHex = clean.slice(lengthOffset, lengthOffset + 64);
    const strLen = Number.parseInt(strLenHex, 16);
    if (!Number.isFinite(strLen) || strLen < 0) return undefined;

    const strStart = lengthOffset + 64;
    const strEnd = strStart + strLen * 2;
    const strHex = clean.slice(strStart, strEnd);
    if (strHex.length !== strLen * 2) return undefined;

    return Buffer.from(strHex, 'hex').toString('utf8');
  } catch {
    return undefined;
  }
}

function extractRpcErrorData(value: unknown): string | undefined {
  if (typeof value === 'string' && value.startsWith('0x')) return value;
  if (!value || typeof value !== 'object') return undefined;

  const maybeData = (value as Record<string, unknown>)['data'];
  if (typeof maybeData === 'string' && maybeData.startsWith('0x')) return maybeData;

  const nested = (value as Record<string, unknown>)['originalError'];
  if (nested && typeof nested === 'object') {
    const nestedData = (nested as Record<string, unknown>)['data'];
    if (typeof nestedData === 'string' && nestedData.startsWith('0x')) return nestedData;
  }

  return undefined;
}

function extractRpcErrorDetail(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;

  const msg = (value as Record<string, unknown>)['message'];
  if (typeof msg === 'string') return msg;

  const reason = (value as Record<string, unknown>)['reason'];
  if (typeof reason === 'string') return reason;

  return undefined;
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

function callFramesToDecodedCalls(
  root: RpcCallFrame | undefined,
): mcp.deployer.TraceOutput['decodedCalls'] {
  if (!root) return [];

  const out: mcp.deployer.TraceOutput['decodedCalls'] = [];
  const walk = (frame: RpcCallFrame, depth: number) => {
    if (frame.to) {
      out.push({
        depth,
        to: frame.to as `0x${string}`,
        fn: frame.type ?? 'call',
        args: [],
        result: frame.output ?? null,
        reverted: Boolean(frame.error ?? frame.revertReason),
      });
    }
    for (const child of frame.calls ?? []) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return out;
}

export function createDeployerService(opts: {
  chainRpcUrl: string;
  workspaceRoot: string;
  compilerUrl?: string;
}): DeployerService {
  const { chainRpcUrl, compilerUrl = 'http://localhost:3101' } = opts;

  /**
   * Fetch contract bytecode from mcp-compiler.
   * Throws if the contract is not found in the artifact store.
   */
  async function getCompiledBytecode(contractName: string): Promise<string> {
    const res = await fetch(`${compilerUrl}/bytecode/${contractName}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          `Contract "${contractName}" not found in artifact store — compile it first or provide raw bytecode`,
        );
      }
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to fetch bytecode from compiler: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { bytecode?: string };
    if (!data.bytecode) {
      throw new Error(`Compiler returned no bytecode for "${contractName}"`);
    }
    return data.bytecode;
  }

  return {
    async deployLocal(input) {
      const sender =
        input.sender ??
        (await rpc<string[]>(chainRpcUrl, 'eth_accounts')).at(0) ??
        (() => {
          throw new Error('No local chain accounts available');
        })();

      const bytecode = await getCompiledBytecode(input.contractName);
      const data = `${bytecode}${input.constructorData.slice(2)}`;
      const txHash = await rpc<string>(chainRpcUrl, 'eth_sendTransaction', [
        {
          from: sender,
          to: null,
          data,
          ...(input.value !== undefined ? { value: toHexQuantity(input.value) } : {}),
        },
      ]);

      const receipt = await waitForReceipt(chainRpcUrl, txHash);
      if (!receipt.contractAddress) {
        throw new Error(`Deploy transaction did not produce a contract address: ${txHash}`);
      }

      return {
        address: receipt.contractAddress as `0x${string}`,
        txHash: txHash as `0x${string}`,
        gasUsed: encodeBigInt(BigInt(receipt.gasUsed)),
      };
    },

    async simulateLocal(input) {
      const tx = {
        ...(input.tx.from ? { from: input.tx.from } : {}),
        ...(input.tx.to ? { to: input.tx.to } : { to: null }),
        data: input.tx.data,
        ...(input.tx.value !== undefined ? { value: toHexQuantity(input.tx.value) } : {}),
        ...(input.tx.gas !== undefined ? { gas: toHexQuantity(input.tx.gas) } : {}),
      };

      const [callRes, estimateRes] = await Promise.all([
        rpcWithError<string>(chainRpcUrl, 'eth_call', [tx, 'latest']),
        rpcWithError<string>(chainRpcUrl, 'eth_estimateGas', [tx]),
      ]);

      const callErrorData = extractRpcErrorData(callRes.error?.data);
      const revertReason =
        decodeRevertReasonFromData(callErrorData) ?? extractRpcErrorDetail(callRes.error?.data);

      const logs: mcp.deployer.SimulateLocalOutput['logs'] = [];

      return {
        result: (callRes.result ?? '0x') as `0x${string}`,
        gasEstimate:
          estimateRes.result !== undefined
            ? encodeBigInt(BigInt(estimateRes.result))
            : encodeBigInt(input.tx.gas ?? 0n),
        ...(revertReason ? { revertReason } : {}),
        logs,
      };
    },

    async trace(input) {
      const [traceRes, callTraceRes, receipt] = await Promise.all([
        rpcWithError<RpcTraceResult>(chainRpcUrl, 'debug_traceTransaction', [input.txHash, {}]),
        rpcWithError<RpcCallFrame>(chainRpcUrl, 'debug_traceTransaction', [
          input.txHash,
          { tracer: 'callTracer' },
        ]),
        rpc<RpcReceipt | null>(chainRpcUrl, 'eth_getTransactionReceipt', [input.txHash]),
      ]);

      if (!receipt) {
        throw new Error(`Transaction receipt not found: ${input.txHash}`);
      }

      const revertData = extractRpcErrorData(traceRes.error?.data);
      const revertReason =
        decodeRevertReasonFromData(revertData) ??
        traceRes.result?.revertReason ??
        callTraceRes.result?.revertReason ??
        extractRpcErrorDetail(traceRes.error?.data);

      return {
        txHash: receipt.transactionHash as `0x${string}`,
        decodedCalls: callFramesToDecodedCalls(callTraceRes.result),
        storageReads: [],
        storageWrites: [],
        events: [],
        ...(revertReason ? { revertReason } : {}),
        gasUsed: encodeBigInt(BigInt(receipt.gasUsed)),
      };
    },

    async call(input) {
      const result = await rpc<string>(chainRpcUrl, 'eth_call', [
        {
          to: input.to,
          data: input.data,
          ...(input.from ? { from: input.from } : {}),
        },
        'latest',
      ]);
      return { result: result as `0x${string}` };
    },
  };
}
