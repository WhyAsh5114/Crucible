import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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

async function readPatterns(filePath: string): Promise<StoredPattern[]> {
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

async function writePatterns(filePath: string, patterns: StoredPattern[]): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(patterns, null, 2) + '\n', 'utf8');
}

export function createMemoryService(opts: { workspaceRoot: string }): MemoryService {
  const patternsPath = join(opts.workspaceRoot, '.crucible', 'memory', 'patterns.json');
  const authorNode = process.env['NODE_ID'] ?? 'local-node';
  const originalSession = process.env['SESSION_ID'] ?? 'local-session';

  return {
    async recall(input) {
      const patterns = await readPatterns(patternsPath);
      const ranked = patterns
        .map((pattern) => ({ pattern, score: scorePattern(pattern, input) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.pattern.createdAt - a.pattern.createdAt);

      const limit = input.limit ?? 5;
      return {
        hits: ranked.slice(0, limit),
      };
    },

    async remember(input) {
      const patterns = await readPatterns(patternsPath);
      const id = `pattern-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const entry: StoredPattern = {
        id,
        revertSignature: input.revertSignature,
        patch: input.patch,
        traceRef: input.traceRef,
        verificationReceipt: input.verificationReceipt,
        provenance: {
          authorNode,
          originalSession,
        },
        scope: input.scope,
        createdAt: Date.now(),
      };
      patterns.push(entry);
      await writePatterns(patternsPath, patterns);
      return { id };
    },

    async listPatterns(input) {
      const patterns = await readPatterns(patternsPath);
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
      const patterns = await readPatterns(patternsPath);
      const found = patterns.find((pattern) => pattern.id === input.id);
      if (!found) {
        throw new Error(`Pattern not found: ${input.id}`);
      }
      return found.provenance;
    },
  };
}
