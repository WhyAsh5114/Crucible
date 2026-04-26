import { workspaceHostPath } from './workspace-fs';
import { ensureWorkspaceContainer, execInWorkspaceContainer } from './runtime-docker';

type ToolExecInput = {
  tool: string;
  args: unknown;
  workspaceId: string;
  server: 'chain' | 'compiler' | 'deployer' | 'wallet' | 'terminal';
};

type ToolExecOutcome =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error: string;
    };

const EMPTY_CHAIN_STATE = {
  chainId: 31337,
  blockNumber: 0,
  gasPrice: '0',
  accounts: [],
  isForked: false,
  activeSnapshotIds: [],
};

function unsupported(tool: string, server: string): ToolExecOutcome {
  return {
    ok: false,
    error: `tool '${tool}' is not implemented for server '${server}'`,
  };
}

async function compilerListContracts(workspaceId: string): Promise<ToolExecOutcome> {
  const command =
    'if [ -d contracts ]; then for f in contracts/*.sol; do [ -e "$f" ] || continue; basename "$f" .sol; done | sort; fi';
  const execResult = await execInWorkspaceContainer(workspaceId, ['sh', '-c', command]);

  if (execResult.code !== 0) {
    return {
      ok: false,
      error: execResult.stderr || execResult.stdout || 'Failed to list contracts',
    };
  }

  const contracts = execResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    ok: true,
    result: { contracts },
  };
}

async function chainGetState(workspaceId: string): Promise<ToolExecOutcome> {
  const command =
    "if [ -f .crucible/chain-state.json ]; then cat .crucible/chain-state.json; else echo '{}' ; fi";
  const execResult = await execInWorkspaceContainer(workspaceId, ['sh', '-c', command]);

  if (execResult.code !== 0) {
    return {
      ok: false,
      error: execResult.stderr || execResult.stdout || 'Failed to get chain state',
    };
  }

  const raw = execResult.stdout.trim();
  if (!raw) {
    return {
      ok: true,
      result: EMPTY_CHAIN_STATE,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ok: true,
      result: {
        ...EMPTY_CHAIN_STATE,
        ...parsed,
      },
    };
  } catch {
    return {
      ok: true,
      result: EMPTY_CHAIN_STATE,
    };
  }
}

export async function executeRuntimeTool(input: ToolExecInput): Promise<ToolExecOutcome> {
  if (input.server !== 'compiler' && input.server !== 'chain') {
    return {
      ok: false,
      error: `tool_exec server '${input.server}' is not implemented yet`,
    };
  }

  await ensureWorkspaceContainer(input.workspaceId, workspaceHostPath(input.workspaceId));

  if (input.server === 'compiler') {
    if (input.tool === 'list_contracts') {
      return compilerListContracts(input.workspaceId);
    }
    return unsupported(input.tool, input.server);
  }

  if (input.server === 'chain') {
    if (input.tool === 'get_state') {
      return chainGetState(input.workspaceId);
    }
    return unsupported(input.tool, input.server);
  }

  return unsupported(input.tool, input.server);
}
