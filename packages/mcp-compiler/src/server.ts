/**
 * McpServer factory for mcp-compiler.
 *
 * Registers four tools — compile, get_abi, get_bytecode, list_contracts —
 * using schemas from @crucible/types/mcp/compiler.
 */

import { join, relative, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  CompileInputSchema,
  GetAbiInputSchema,
  GetBytecodeInputSchema,
  ListContractsInputSchema,
  type CompileInput,
  type GetAbiInput,
  type GetBytecodeInput,
} from '@crucible/types/mcp/compiler';
import { compileSolidity, type SolcSettings } from './compiler.ts';
import { createArtifactStore } from './artifact-store.ts';

/**
 * Resolve symlinks on both paths and verify `candidatePath` is contained
 * within `workspaceRoot`. Returns the workspace-relative path on success.
 * Throws with a descriptive message on containment failure.
 *
 * Uses `realpath` to prevent symlink-escape attacks where a symlink inside
 * the workspace root points to a file outside it.
 */
export async function assertContainedInWorkspace(
  workspaceRoot: string,
  candidatePath: string,
): Promise<string> {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(workspaceRoot),
    // candidatePath may not exist yet; fall back to the un-resolved path so
    // compilation errors surface from solc rather than from path validation.
    realpath(candidatePath).catch(() => candidatePath),
  ]);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('sourcePath must resolve within the workspace root');
  }
  return rel;
}

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createCompilerServer(opts: {
  workspaceRoot: string;
  solcVersion?: string | undefined;
}): McpServer {
  const store = createArtifactStore();
  const server = new McpServer({
    name: 'crucible-compiler',
    version: '0.0.0',
  });

  // ── compile ────────────────────────────────────────────────────────────────

  server.registerTool(
    'compile',
    {
      description:
        'Compile a Solidity source file at the given workspace-relative path. ' +
        'Stores artifacts in-process for subsequent get_abi / get_bytecode calls. ' +
        'Returns all contracts found in the file.',
      inputSchema: CompileInputSchema,
    },
    async ({ sourcePath, settings }: CompileInput) => {
      try {
        const absolutePath = join(opts.workspaceRoot, sourcePath);
        let rel: string;
        try {
          rel = await assertContainedInWorkspace(opts.workspaceRoot, absolutePath);
        } catch (e) {
          return errorResult(`compile failed: ${String(e)}`);
        }
        const result = await compileSolidity(absolutePath, {
          version: opts.solcVersion,
          ...(settings ?? {}),
        } as SolcSettings);
        store.storeContracts(result.contracts, rel);
        await store.persistArtifacts(opts.workspaceRoot, result.contracts);

        // Deduplicate warnings by message text and surface them at the top level
        // so the agent sees a clean summary without iterating over every contract.
        const seen = new Set<string>();
        const topWarnings = result.warnings.filter((w) => {
          if (seen.has(w.message)) return false;
          seen.add(w.message);
          return true;
        });

        return toolResult({
          contracts: result.contracts,
          ...(topWarnings.length > 0 ? { warnings: topWarnings } : {}),
        });
      } catch (err) {
        return errorResult(`compile failed: ${String(err)}`);
      }
    },
  );

  // ── get_abi ────────────────────────────────────────────────────────────────

  server.registerTool(
    'get_abi',
    {
      description:
        'Return the ABI for a previously compiled contract. ' +
        'Accepts a short name ("Counter") or fully-qualified name ("Counter.sol:Counter").',
      inputSchema: GetAbiInputSchema,
    },
    async ({ contractName }: GetAbiInput) => {
      try {
        const artifact = store.resolveContract(contractName);
        if (!artifact) {
          return errorResult(`Contract "${contractName}" not found. Run compile first.`);
        }
        return toolResult({ abi: artifact.abi });
      } catch (err) {
        return errorResult(`get_abi failed: ${String(err)}`);
      }
    },
  );

  // ── get_bytecode ───────────────────────────────────────────────────────────

  server.registerTool(
    'get_bytecode',
    {
      description: 'Return the creation and deployed bytecode for a previously compiled contract.',
      inputSchema: GetBytecodeInputSchema,
    },
    async ({ contractName }: GetBytecodeInput) => {
      try {
        const artifact = store.resolveContract(contractName);
        if (!artifact) {
          return errorResult(`Contract "${contractName}" not found. Run compile first.`);
        }
        return toolResult({
          bytecode: artifact.bytecode,
          deployedBytecode: artifact.deployedBytecode,
        });
      } catch (err) {
        return errorResult(`get_bytecode failed: ${String(err)}`);
      }
    },
  );

  // ── list_contracts ─────────────────────────────────────────────────────────

  server.registerTool(
    'list_contracts',
    {
      description: 'List fully-qualified names of all contracts currently cached from compilation.',
      inputSchema: ListContractsInputSchema,
    },
    async () => {
      try {
        return toolResult({ contracts: store.listContractNames() });
      } catch (err) {
        return errorResult(`list_contracts failed: ${String(err)}`);
      }
    },
  );

  return server;
}
