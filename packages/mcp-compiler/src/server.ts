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
import { abiFunctionSignatures } from '@crucible/types';
import { compileSolidity, type SolcSettings } from './compiler.ts';
import type { ArtifactStore } from './artifact-store.ts';

const TAG = '[mcp-compiler]';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
const logWarn = (msg: string) => console.warn(`${TAG} ${msg}`);
const logError = (msg: string) => console.error(`${TAG} ${msg}`);

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
  const resolvedRoot = await realpath(workspaceRoot);
  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(candidatePath);
  } catch {
    // File doesn't exist yet. Swap the raw workspaceRoot prefix for the
    // resolved root so symlink differences (e.g. /tmp → /private/tmp on macOS)
    // don't cause a false "outside workspace" rejection.
    resolvedCandidate = candidatePath.startsWith(workspaceRoot)
      ? resolvedRoot + candidatePath.slice(workspaceRoot.length)
      : candidatePath;
  }
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
  store: ArtifactStore;
}): McpServer {
  const store = opts.store;
  const server = new McpServer({
    name: 'crucible-compiler',
    version: '0.0.0',
  });

  // ── compile ────────────────────────────────────────────────────────────────

  server.registerTool(
    'compile',
    {
      title: 'Compile Solidity',
      description:
        'Compile a Solidity source file from the workspace. ' +
        'Provide sourcePath as a workspace-relative path to an existing .sol file ' +
        '(e.g. "contracts/Counter.sol"). ' +
        'Stores artifacts in-process for subsequent get_abi / get_bytecode / deploy_local calls. ' +
        'Returns all contracts found in the file, along with any compiler warnings.',
      inputSchema: CompileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sourcePath, settings }: CompileInput) => {
      try {
        log(`tool:compile path=${sourcePath}`);
        const absolutePath = join(opts.workspaceRoot, sourcePath);
        let rel: string;
        try {
          rel = await assertContainedInWorkspace(opts.workspaceRoot, absolutePath);
        } catch (e) {
          logError(`tool:compile error: ${String(e)}`);
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

        const contractNames = result.contracts.map((c) => c.name);
        log(
          `tool:compile ok  contracts=[${contractNames.join(', ')}] warnings=${topWarnings.length}`,
        );
        for (const w of topWarnings) {
          logWarn(`tool:compile warn: ${w.message}`);
        }
        return toolResult({
          contracts: result.contracts,
          ...(topWarnings.length > 0 ? { warnings: topWarnings } : {}),
        });
      } catch (err) {
        logError(`tool:compile error: ${String(err)}`);
        return errorResult(`compile failed: ${String(err)}`);
      }
    },
  );

  // ── get_abi ────────────────────────────────────────────────────────────────

  server.registerTool(
    'get_abi',
    {
      title: 'Get Contract ABI',
      description:
        'Return the ABI for a previously compiled contract. ' +
        'Accepts a short name ("Counter") or fully-qualified name ("Counter.sol:Counter"). ' +
        'The ABI describes all public functions and events — use it to construct calls/transactions.',
      inputSchema: GetAbiInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ contractName }: GetAbiInput) => {
      try {
        const artifact = store.resolveContract(contractName);
        if (!artifact) {
          logWarn(`tool:get_abi not found: ${contractName}`);
          return errorResult(`Contract "${contractName}" not found. Run compile first.`);
        }
        log(`tool:get_abi ok  contract=${contractName} fns=${(artifact.abi as unknown[]).length}`);
        return toolResult({ abi: artifact.abi });
      } catch (err) {
        logError(`tool:get_abi error: ${String(err)}`);
        return errorResult(`get_abi failed: ${String(err)}`);
      }
    },
  );

  // ── get_bytecode ───────────────────────────────────────────────────────────

  server.registerTool(
    'get_bytecode',
    {
      title: 'Get Contract Bytecode',
      description:
        'Return the creation bytecode and deployed bytecode for a previously compiled contract. ' +
        'Use creation bytecode for deployment transactions; use deployed bytecode for size checks or static analysis.',
      inputSchema: GetBytecodeInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ contractName }: GetBytecodeInput) => {
      try {
        const artifact = store.resolveContract(contractName);
        if (!artifact) {
          logWarn(`tool:get_bytecode not found: ${contractName}`);
          return errorResult(`Contract "${contractName}" not found. Run compile first.`);
        }
        const creationBytes = Math.ceil((artifact.bytecode.length - 2) / 2);
        log(`tool:get_bytecode ok  contract=${contractName} creationBytes=${creationBytes}`);
        return toolResult({
          bytecode: artifact.bytecode,
          deployedBytecode: artifact.deployedBytecode,
        });
      } catch (err) {
        logError(`tool:get_bytecode error: ${String(err)}`);
        return errorResult(`get_bytecode failed: ${String(err)}`);
      }
    },
  );

  // ── list_contracts ─────────────────────────────────────────────────────────

  server.registerTool(
    'list_contracts',
    {
      title: 'List Compiled Contracts',
      description:
        'List fully-qualified names of all contracts currently cached from compilation. ' +
        'Use these names with get_abi and get_bytecode. ' +
        'The cache is in-process and resets when the server restarts.',
      inputSchema: ListContractsInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const contracts = store.listContractNames();
        const summaries = contracts
          .map((fqn) => {
            const compiled = store.getContract(fqn);
            if (!compiled) return null;
            const shortName = fqn.includes(':') ? fqn.split(':').pop()! : fqn;
            return {
              name: fqn,
              shortName,
              abi: compiled.abi,
              functions: abiFunctionSignatures(compiled.abi),
            };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);
        log(`tool:list_contracts ok  count=${contracts.length}`);
        return toolResult({ contracts, summaries });
      } catch (err) {
        logError(`tool:list_contracts error: ${String(err)}`);
        return errorResult(`list_contracts failed: ${String(err)}`);
      }
    },
  );

  // ── prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'compiler_workflow',
    {
      title: 'Solidity Compiler Workflow',
      description:
        'Step-by-step guide for compiling Solidity contracts and retrieving their artifacts.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are connected to the crucible-compiler MCP server, which compiles Solidity source files.',
              '',
              'Typical workflow:',
              '1. Call compile(sourcePath) — a workspace-relative path to a .sol file',
              '   (e.g. "contracts/Counter.sol"). Returns contract names and any warnings.',
              '   Artifacts (ABI, bytecode) are persisted to .crucible/artifacts/.',
              '2. Call list_contracts to see all currently cached contract names.',
              '3. Call get_abi(contractName) to retrieve the ABI.',
              '   - Required by front-end clients and interaction tools.',
              "4. Call get_bytecode for inspection only. crucible-deployer's deploy_local",
              '   fetches bytecode automatically by contract name.',
              '',
              'Tool reference:',
              '  compile        — Compile a workspace .sol file; returns contract names and warnings.',
              '  list_contracts — Read-only: list all cached contract names.',
              '  get_abi        — Read-only: get the ABI for a compiled contract.',
              '  get_bytecode   — Read-only: get creation and deployed bytecode.',
              '',
              'Notes:',
              '  - sourcePath must be workspace-relative, not absolute.',
              '  - Artifacts survive server restarts (stored on disk).',
              '  - Recompile to pick up source changes.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'deploy_contract',
    {
      title: 'Compile & Deploy Contract',
      description:
        'End-to-end guide: compile a Solidity contract then deploy it via crucible-deployer.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'End-to-end deployment flow using crucible-compiler, crucible-chain, and crucible-deployer:',
              '',
              '1. [compiler] compile(sourcePath) → note the contract name(s) returned.',
              '2. [compiler] get_abi(contractName) → save the ABI for later interaction.',
              '3. [chain]    start_node → ensure a local EVM node is running.',
              '4. [chain]    snapshot → save state before deployment.',
              '5. [deployer] deploy_local(contractName, constructorData) → returns address and txHash.',
              '   - constructorData is ABI-encoded constructor args ("0x" if none).',
              '   - Bytecode is fetched automatically from the compiler artifact store.',
              '   - Optionally pass sender (defaults to first local account) and value.',
              '6. Interact with the deployed contract using its ABI and the returned address.',
              '7. [chain]    revert(snapshotId) to roll back between test scenarios.',
              '',
              'Tips:',
              '  - If deploy_local returns "Contract not found", run compile first.',
              '  - Take a new snapshot after each successful deploy to create a clean baseline.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
