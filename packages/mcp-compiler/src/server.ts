/**
 * McpServer factory for mcp-compiler.
 *
 * Registers four tools — compile, get_abi, get_bytecode, list_contracts —
 * using schemas from @crucible/types/mcp/compiler and dispatches to either
 * real solc-js or mock implementations based on COMPILER_MOCK env flag.
 */

import { basename, join } from 'node:path';
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
import { compileSolidity } from './compiler.ts';
import { storeContracts, resolveContract, listContractNames, persistArtifacts } from './artifact-store.ts';
import { mockCompile, mockGetAbi, mockGetBytecode, mockListContracts } from './mock.ts';

const IS_MOCK = process.env['COMPILER_MOCK'] === 'true';

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

export function createCompilerServer(opts: { workspaceRoot: string }): McpServer {
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
        if (IS_MOCK) return toolResult(mockCompile(sourcePath));

        const absolutePath = join(opts.workspaceRoot, sourcePath);
        const result = compileSolidity(absolutePath, settings as Record<string, unknown>);
        storeContracts(result.contracts, basename(absolutePath));
        await persistArtifacts(opts.workspaceRoot, result.contracts);
        return toolResult({ contracts: result.contracts });
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
        if (IS_MOCK) return toolResult(mockGetAbi());

        const artifact = resolveContract(contractName);
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
        if (IS_MOCK) return toolResult(mockGetBytecode());

        const artifact = resolveContract(contractName);
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
        if (IS_MOCK) return toolResult(mockListContracts());
        return toolResult({ contracts: listContractNames() });
      } catch (err) {
        return errorResult(`list_contracts failed: ${String(err)}`);
      }
    },
  );

  return server;
}
