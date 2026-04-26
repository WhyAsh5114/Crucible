/**
 * McpServer factory for mcp-compiler.
 *
 * Registers four tools — compile, get_abi, get_bytecode, list_contracts —
 * using schemas from @crucible/types/mcp/compiler.
 */

import { join, relative, isAbsolute } from 'node:path';
import { realpath, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
      title: 'Compile Solidity',
      description:
        'Compile a Solidity contract. Provide either:\n' +
        '  • sourcePath — workspace-relative path of an existing .sol file, OR\n' +
        '  • source    — inline Solidity source code (string); use fileName to set the .sol name.\n' +
        'Exactly one of sourcePath/source must be supplied. Passing both is an error.\n' +
        'Stores artifacts in-process for subsequent get_abi / get_bytecode calls. ' +
        'Returns all contracts found in the file, along with any compiler warnings.',
      inputSchema: CompileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sourcePath, source, fileName, settings }: CompileInput) => {
      let tempDir: string | undefined;
      try {
        let absolutePath: string;
        let rel: string;

        if (source !== undefined) {
          // Inline source — write inside the workspace so Hardhat's project-root
          // boundary check passes (files outside the project root are rejected).
          const solFileName = fileName ?? 'Inline.sol';
          log(`tool:compile inline=${solFileName} (${source.split('\n').length} lines)`);
          tempDir = join(opts.workspaceRoot, '.crucible', 'tmp', `inline-${randomUUID()}`);
          await mkdir(tempDir, { recursive: true });
          absolutePath = join(tempDir, solFileName);
          await writeFile(absolutePath, source, 'utf8');
          rel = `<inline>/${solFileName}`;
        } else {
          log(`tool:compile path=${sourcePath}`);
          absolutePath = join(opts.workspaceRoot, sourcePath!);
          try {
            rel = await assertContainedInWorkspace(opts.workspaceRoot, absolutePath);
          } catch (e) {
            logError(`tool:compile error: ${String(e)}`);
            return errorResult(`compile failed: ${String(e)}`);
          }
        }
        const result = await compileSolidity(absolutePath, {
          version: opts.solcVersion,
          ...(settings ?? {}),
        } as SolcSettings);
        store.storeContracts(result.contracts, rel);
        // Only persist artifacts to disk for workspace files, not inline source.
        if (!tempDir) {
          await store.persistArtifacts(opts.workspaceRoot, result.contracts);
        }

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
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true });
        }
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
        log(`tool:list_contracts ok  count=${contracts.length}`);
        return toolResult({ contracts });
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
              '1. Call compile to compile a Solidity contract. Two modes:',
              '   a) File mode: pass sourcePath (workspace-relative, e.g. "src/Counter.sol")',
              '   b) Inline mode: pass source (raw Solidity code as a string) and optionally',
              '      fileName (e.g. "Counter.sol") to control the artifact identifier.',
              '   Only one of sourcePath or source may be provided — passing both is an error.',
              '   Returns a list of contract names found in the file, plus any compiler warnings.',
              '   Artifacts are cached in-process for the lifetime of the server.',
              '2. Call list_contracts to see all currently cached contract names.',
              '3. Call get_abi with the contract name to retrieve its ABI.',
              '   - The ABI is required by deployment and interaction tools.',
              '4. Call get_bytecode with the contract name to retrieve creation + deployed bytecode.',
              '   - Use creation bytecode when sending a deployment transaction.',
              '',
              'Tool reference:',
              '  compile        — Compile a .sol file or inline source; returns contract names and warnings.',
              '  list_contracts — Read-only: list all cached contract names.',
              '  get_abi        — Read-only: get the ABI for a compiled contract.',
              '  get_bytecode   — Read-only: get creation and deployed bytecode.',
              '',
              'Notes:',
              '  - sourcePath must be relative to the workspace root, not an absolute path.',
              '  - Inline source (source field) is compiled in a temp directory and not persisted.',
              '  - Artifact cache is reset when the server restarts.',
              '  - Recompile a file to pick up source changes.',
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
        'End-to-end guide: compile a Solidity contract, retrieve its artifacts, then deploy it using the chain server.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'End-to-end deployment flow using both crucible-compiler and crucible-chain:',
              '',
              '1. [compiler] compile the source file → note the contract name.',
              '2. [compiler] get_abi  → save the ABI for later interaction.',
              '3. [compiler] get_bytecode → get creation bytecode for the deploy tx.',
              '4. [chain]    start_node → ensure a local EVM node is running.',
              '5. [chain]    get_state → pick a funded account from the accounts list.',
              '6. [chain]    snapshot → save state before deployment.',
              '7. Deploy by sending an eth_sendTransaction (or equivalent) with:',
              '     from: <funded account>',
              '     data: <creation bytecode>',
              '     gas:  estimate via eth_estimateGas first.',
              '8. Confirm deployment by calling eth_getTransactionReceipt.',
              '9. Interact with the deployed contract using its ABI and the returned address.',
              '',
              'To test multiple deployment scenarios, call revert between each run.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
