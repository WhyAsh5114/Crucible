import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  Batcher,
  Indexer,
  KvClient,
  getFlowContract,
  type StorageNode,
} from '@0gfoundation/0g-storage-ts-sdk';
import { JsonRpcProvider, Wallet, computeAddress, hexlify, zeroPadValue } from 'ethers';
import { type mcp } from '@crucible/types';

interface StoredPattern {
  id: string;
  revertSignature: string;
  patch: string;
  traceRef: string;
  verificationReceipt: `0x${string}`;
  provenance: {
    authorNode: string;
    originalSession: string;
    derivedFrom?: string[];
  };
  scope: 'local' | 'mesh';
  createdAt: number;
}

export interface MemoryService {
  recall: (
    input: mcp.memory.RecallInput,
  ) => Promise<{ hits: Array<{ pattern: StoredPattern; score: number }> }>;
  remember: (input: mcp.memory.RememberInput) => Promise<{ id: string }>;
  listPatterns: (
    input: mcp.memory.ListPatternsInput,
  ) => Promise<{ patterns: StoredPattern[]; nextCursor: string | null }>;
  provenance: (input: mcp.memory.ProvenanceInput) => Promise<StoredPattern['provenance']>;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function safeParseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('cursor must be a non-negative integer string');
  }
  return parsed;
}

function similarityByContainment(needle: string, haystack: string): number {
  if (!needle) return 0;
  if (haystack === needle) return 1;
  if (haystack.includes(needle)) {
    const ratio = needle.length / Math.max(needle.length, haystack.length);
    return Math.max(0.7, ratio);
  }
  if (needle.includes(haystack) && haystack.length > 0) {
    const ratio = haystack.length / needle.length;
    return Math.max(0.5, ratio * 0.8);
  }
  return 0;
}

function scorePattern(pattern: StoredPattern, input: mcp.memory.RecallInput): number {
  const fields = [pattern.revertSignature, pattern.patch, pattern.traceRef].map(normalize);

  let score = 0;

  const queryRevert = normalize(input.revertSignature ?? '');
  if (queryRevert) {
    score = Math.max(
      score,
      similarityByContainment(queryRevert, normalize(pattern.revertSignature)),
    );
  }

  const queryContract = normalize(input.contractPattern ?? '');
  if (queryContract) {
    score = Math.max(
      score,
      ...fields.map((field) => similarityByContainment(queryContract, field) * 0.9),
    );
  }

  const queryFreeform = normalize(input.freeform ?? '');
  if (queryFreeform) {
    score = Math.max(
      score,
      ...fields.map((field) => similarityByContainment(queryFreeform, field) * 0.8),
    );
  }

  return Number(score.toFixed(4));
}

function rankAndPaginate(
  patterns: StoredPattern[],
  input: mcp.memory.RecallInput,
): Array<{ pattern: StoredPattern; score: number }> {
  return patterns
    .map((pattern) => ({ pattern, score: scorePattern(pattern, input) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.pattern.createdAt - a.pattern.createdAt);
}

function newPatternId(): string {
  return `pattern-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

// ---------- Local FS backend ----------

async function readPatternsFs(filePath: string): Promise<StoredPattern[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as StoredPattern[];
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { patterns?: unknown }).patterns)
    ) {
      return (parsed as { patterns: StoredPattern[] }).patterns;
    }
    return [];
  } catch {
    return [];
  }
}

async function writePatternsFs(filePath: string, patterns: StoredPattern[]): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(patterns, null, 2) + '\n', 'utf8');
}

function createFsService(opts: {
  patternsPath: string;
  authorNode: string;
  originalSession: string;
}): MemoryService {
  const { patternsPath, authorNode, originalSession } = opts;
  return {
    async recall(input) {
      const patterns = await readPatternsFs(patternsPath);
      const limit = input.limit ?? 5;
      return { hits: rankAndPaginate(patterns, input).slice(0, limit) };
    },
    async remember(input) {
      const patterns = await readPatternsFs(patternsPath);
      const id = newPatternId();
      patterns.push({
        id,
        revertSignature: input.revertSignature,
        patch: input.patch,
        traceRef: input.traceRef,
        verificationReceipt: input.verificationReceipt,
        provenance: { authorNode, originalSession },
        scope: input.scope,
        createdAt: Date.now(),
      });
      await writePatternsFs(patternsPath, patterns);
      return { id };
    },
    async listPatterns(input) {
      const patterns = await readPatternsFs(patternsPath);
      const filtered = input.scope
        ? patterns.filter((pattern) => pattern.scope === input.scope)
        : patterns;
      const offset = safeParseCursor(input.cursor);
      const limit = input.limit ?? 50;
      const page = filtered.slice(offset, offset + limit);
      const next = offset + page.length;
      return {
        patterns: page,
        nextCursor: next < filtered.length ? String(next) : null,
      };
    },
    async provenance(input) {
      const patterns = await readPatternsFs(patternsPath);
      const found = patterns.find((pattern) => pattern.id === input.id);
      if (!found) throw new Error(`Pattern not found: ${input.id}`);
      return found.provenance;
    },
  };
}

// ---------- 0G Storage KV backend ----------

interface KvConfig {
  privateKey: string;
  rpcUrl: string;
  indexerUrl: string;
  kvUrl: string;
  localStreamId: string;
  meshStreamId: string;
  authorNode: string;
  originalSession: string;
}

function streamIdForScope(cfg: KvConfig, scope: 'local' | 'mesh'): string {
  return scope === 'local' ? cfg.localStreamId : cfg.meshStreamId;
}

function encodeKey(id: string): Uint8Array {
  return new Uint8Array(Buffer.from(id, 'utf-8'));
}

function decodeBase64ToString(data: string): string {
  return Buffer.from(data, 'base64').toString('utf-8');
}

function createKvService(cfg: KvConfig): MemoryService {
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const signer = new Wallet(cfg.privateKey, provider);
  const indexer = new Indexer(cfg.indexerUrl);
  const kvClient = new KvClient(cfg.kvUrl);

  let cachedNodes: StorageNode[] | null = null;
  let cachedFlowAddress: string | null = null;

  async function getNodes(): Promise<StorageNode[]> {
    if (cachedNodes) return cachedNodes;
    const [nodes, err] = await indexer.selectNodes(1);
    if (err) throw new Error(`0G indexer selectNodes failed: ${err.message}`);
    cachedNodes = nodes;
    return nodes;
  }

  async function getFlowAddress(): Promise<string> {
    if (cachedFlowAddress) return cachedFlowAddress;
    const nodes = await getNodes();
    const status = await nodes[0]!.getStatus();
    cachedFlowAddress = status.networkIdentity.flowAddress;
    return cachedFlowAddress;
  }

  async function writePattern(pattern: StoredPattern): Promise<void> {
    const nodes = await getNodes();
    const flowAddress = await getFlowAddress();
    const flow = getFlowContract(flowAddress, signer);
    // Use Date.now() as the batch version so each write is strictly greater
    // than the previous one — the 0G KV indexer silently discards batches
    // whose version is not strictly greater than the stream's current version.
    const batcher = new Batcher(Date.now(), nodes, flow, cfg.rpcUrl);
    const streamId = streamIdForScope(cfg, pattern.scope);
    const key = encodeKey(pattern.id);
    const value = new Uint8Array(Buffer.from(JSON.stringify(pattern), 'utf-8'));
    batcher.streamDataBuilder.set(streamId, key, value);
    const [, err] = await batcher.exec();
    if (err) throw new Error(`0G KV write failed: ${err.message}`);
  }

  async function readAllPatterns(scope: 'local' | 'mesh'): Promise<StoredPattern[]> {
    const streamId = streamIdForScope(cfg, scope);
    const iterator = kvClient.newIterator(streamId);
    const out: StoredPattern[] = [];

    let seekErr: Error | null;
    try {
      seekErr = await iterator.seekToFirst();
    } catch (err) {
      // Network error or KV node unavailable — return empty rather than
      // failing the whole recall.
      console.warn(`[mcp-memory] KV seekToFirst threw for scope="${scope}": ${String(err)}`);
      return out;
    }

    if (seekErr) {
      // Stream is empty, not yet indexed by the KV node, or temporarily
      // unavailable. Return empty so a single bad scope doesn't block the
      // other scope's results from being returned.
      console.warn(`[mcp-memory] KV seekToFirst error scope="${scope}": ${seekErr.message}`);
      return out;
    }

    while (iterator.valid()) {
      const pair = iterator.getCurrentPair();
      if (pair) {
        try {
          const json = decodeBase64ToString(pair.data);
          out.push(JSON.parse(json) as StoredPattern);
        } catch {
          // Malformed entry — skip and continue iteration.
        }
      }

      let nextErr: Error | null;
      try {
        nextErr = await iterator.next();
      } catch (err) {
        console.warn(`[mcp-memory] KV iterator.next() threw for scope="${scope}": ${String(err)}`);
        break;
      }
      if (nextErr) {
        // Unexpected error during traversal — return what we have so far.
        console.warn(`[mcp-memory] KV iterator error scope="${scope}": ${nextErr.message}`);
        break;
      }
    }

    return out;
  }

  async function readAll(): Promise<StoredPattern[]> {
    const [local, mesh] = await Promise.all([readAllPatterns('local'), readAllPatterns('mesh')]);
    return [...local, ...mesh];
  }

  async function findById(id: string): Promise<StoredPattern | null> {
    for (const scope of ['local', 'mesh'] as const) {
      const streamId = streamIdForScope(cfg, scope);
      const value = await kvClient.getValue(streamId, hexlify(encodeKey(id)));
      if (value) {
        return JSON.parse(decodeBase64ToString(value.data)) as StoredPattern;
      }
    }
    return null;
  }

  return {
    async recall(input) {
      const patterns = await readAll();
      const limit = input.limit ?? 5;
      return { hits: rankAndPaginate(patterns, input).slice(0, limit) };
    },
    async remember(input) {
      const id = newPatternId();
      const pattern: StoredPattern = {
        id,
        revertSignature: input.revertSignature,
        patch: input.patch,
        traceRef: input.traceRef,
        verificationReceipt: input.verificationReceipt,
        provenance: { authorNode: cfg.authorNode, originalSession: cfg.originalSession },
        scope: input.scope,
        createdAt: Date.now(),
      };
      await writePattern(pattern);
      return { id };
    },
    async listPatterns(input) {
      const patterns = input.scope ? await readAllPatterns(input.scope) : await readAll();
      const offset = safeParseCursor(input.cursor);
      const limit = input.limit ?? 50;
      const page = patterns.slice(offset, offset + limit);
      const next = offset + page.length;
      return {
        patterns: page,
        nextCursor: next < patterns.length ? String(next) : null,
      };
    },
    async provenance(input) {
      const found = await findById(input.id);
      if (!found) throw new Error(`Pattern not found: ${input.id}`);
      return found.provenance;
    },
  };
}

// ---------- Factory ----------

const DEFAULT_OG_RPC_URL = 'https://evmrpc-testnet.0g.ai';
const DEFAULT_OG_INDEXER_URL = 'https://indexer-storage-testnet-turbo.0g.ai';
const DEFAULT_MESH_STREAM_ID = '0x' + '00'.repeat(31) + '01';

function defaultLocalStreamId(privateKey: string): string {
  // 32-byte stream id derived from signer address (left-padded with zeros).
  const address = computeAddress(privateKey);
  return zeroPadValue(address, 32);
}

export function createMemoryService(opts: { workspaceRoot: string }): MemoryService {
  const authorNode = process.env['NODE_ID'] ?? 'local-node';
  const originalSession = process.env['SESSION_ID'] ?? 'local-session';
  const privateKey = process.env['OG_STORAGE_PRIVATE_KEY'];

  if (privateKey) {
    const kvUrl = process.env['OG_STORAGE_KV_URL'];
    if (!kvUrl) {
      throw new Error('OG_STORAGE_KV_URL is required when OG_STORAGE_PRIVATE_KEY is set');
    }
    return createKvService({
      privateKey,
      rpcUrl: process.env['OG_STORAGE_RPC_URL'] ?? DEFAULT_OG_RPC_URL,
      indexerUrl: process.env['OG_STORAGE_INDEXER_URL'] ?? DEFAULT_OG_INDEXER_URL,
      kvUrl,
      localStreamId: process.env['OG_STORAGE_LOCAL_STREAM_ID'] ?? defaultLocalStreamId(privateKey),
      meshStreamId: process.env['OG_STORAGE_MESH_STREAM_ID'] ?? DEFAULT_MESH_STREAM_ID,
      authorNode,
      originalSession,
    });
  }

  const patternsPath = join(opts.workspaceRoot, '.crucible', 'memory', 'patterns.json');
  return createFsService({ patternsPath, authorNode, originalSession });
}
