import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { WorkspaceFileLangSchema, type WorkspaceFile } from '@crucible/types';

// Resolve to an absolute host path. An empty / unset env var must NOT be
// allowed to fall through as a relative path — Docker bind mounts require
// absolute paths, otherwise the source string is treated as a named-volume
// name and the agent's file writes never reach the workspace container.
const WORKSPACES_ROOT = path.resolve(
  process.env['CRUCIBLE_WORKSPACES_ROOT']?.trim() || '/var/lib/crucible/workspaces',
);
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KiB — skip large binaries/generated files

export function workspaceHostPath(workspaceId: string): string {
  return path.join(WORKSPACES_ROOT, workspaceId);
}

export async function provisionWorkspaceDirectory(workspaceId: string): Promise<string> {
  const workspaceDir = workspaceHostPath(workspaceId);
  await mkdir(path.join(workspaceDir, 'contracts'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'frontend', 'src'), { recursive: true });
  await mkdir(path.join(workspaceDir, '.crucible'), { recursive: true });

  // Scaffold the contracts directory (package.json + starter Counter.sol).
  await scaffoldContracts(path.join(workspaceDir, 'contracts'));

  // Write the React + Vite + wagmi/viem template if the frontend has not yet
  // been initialised (i.e. package.json does not exist).
  await scaffoldFrontend(path.join(workspaceDir, 'frontend'));

  return workspaceDir;
}

// ---------------------------------------------------------------------------
// React + Vite + wagmi/viem scaffold
// ---------------------------------------------------------------------------

async function writeIfAbsent(filePath: string, content: string): Promise<void> {
  try {
    await stat(filePath); // exists → skip
  } catch {
    await writeFile(filePath, content, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Contracts scaffold — Counter.sol starter + package.json for Hardhat
// ---------------------------------------------------------------------------

async function scaffoldContracts(contractsDir: string): Promise<void> {
  // Hardhat's createHardhatRuntimeEnvironment requires a package.json in the
  // project root (the contracts directory) so Node can resolve packages.
  await writeIfAbsent(
    path.join(contractsDir, 'package.json'),
    JSON.stringify({ name: 'crucible-contracts', version: '0.0.0', private: true }, null, 2) + '\n',
  );

  await writeIfAbsent(
    path.join(contractsDir, 'Counter.sol'),
    `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Counter
/// @notice A simple incrementable counter — the canonical Crucible starter contract.
contract Counter {
    uint256 private _count;

    event Incremented(address indexed by, uint256 newCount);
    event Reset(address indexed by);

    /// @notice Increment the counter by 1.
    function increment() external {
        _count += 1;
        emit Incremented(msg.sender, _count);
    }

    /// @notice Reset the counter to 0.
    function reset() external {
        _count = 0;
        emit Reset(msg.sender);
    }

    /// @notice Return the current count.
    function count() external view returns (uint256) {
        return _count;
    }
}
`,
  );
}

// ---------------------------------------------------------------------------
// React + Vite + wagmi/viem scaffold
// ---------------------------------------------------------------------------

async function scaffoldFrontend(frontendDir: string): Promise<void> {
  const pkg = {
    name: 'crucible-preview',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
    dependencies: {
      react: '^19.1.0',
      'react-dom': '^19.1.0',
      viem: '^2.31.3',
      wagmi: '^2.15.6',
      '@tanstack/react-query': '^5.74.4',
    },
    devDependencies: {
      '@types/react': '^19.1.0',
      '@types/react-dom': '^19.1.0',
      '@vitejs/plugin-react': '^4.4.1',
      typescript: '^5.8.3',
      vite: '^6.3.4',
    },
  };

  await writeIfAbsent(path.join(frontendDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  await writeIfAbsent(
    path.join(frontendDir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { strictPort: true },
});
`,
  );

  await writeIfAbsent(
    path.join(frontendDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          isolatedModules: true,
          moduleDetection: 'force',
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n',
  );

  await writeIfAbsent(
    path.join(frontendDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crucible Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  );

  await writeIfAbsent(
    path.join(frontendDir, 'src', 'config.ts'),
    `import { custom, createConfig } from 'wagmi';
import type { EIP1193Provider } from 'viem';
import { foundry } from 'wagmi/chains';

// Route all wagmi calls (reads AND writes) through the injected EIP-1193
// bridge so they pass through the Crucible shell's RPC proxy instead of
// hitting the Hardhat node directly (which isn't reachable from the browser).
// The bridge script is injected before this module by the Crucible launcher.
declare global {
  interface Window {
    ethereum: EIP1193Provider;
  }
}

export const config = createConfig({
  chains: [foundry],
  transports: {
    [foundry.id]: custom(window.ethereum),
  },
});
`,
  );

  await writeIfAbsent(
    path.join(frontendDir, 'src', 'main.tsx'),
    `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './config';
import App from './App';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
`,
  );

  await writeIfAbsent(
    path.join(frontendDir, 'src', 'App.tsx'),
    `import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { COUNTER_ADDRESS, COUNTER_ABI } from './contracts/Counter';

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // Read the current count from the deployed Counter contract.
  const {
    data: count,
    isLoading: countLoading,
    refetch: refetchCount,
  } = useReadContract({
    address: COUNTER_ADDRESS,
    abi: COUNTER_ABI,
    functionName: 'count',
  });

  // Write — shared hook instance, re-used for both increment and reset.
  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();

  const { isLoading: isMining } = useWaitForTransactionReceipt({
    hash: txHash,
    query: {
      enabled: !!txHash,
      // Refetch the count once the tx lands.
      select: (receipt) => {
        void refetchCount();
        return receipt;
      },
    },
  });

  const busy = isPending || isMining;

  function handleIncrement() {
    writeContract({ address: COUNTER_ADDRESS, abi: COUNTER_ABI, functionName: 'increment' });
  }

  function handleReset() {
    writeContract({ address: COUNTER_ADDRESS, abi: COUNTER_ABI, functionName: 'reset' });
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '480px' }}>
      <h1 style={{ marginBottom: '1rem' }}>Counter Demo</h1>

      {!isConnected ? (
        <div>
          <p style={{ color: '#888', marginBottom: '0.75rem' }}>Connect a wallet to interact with the Counter contract.</p>
          {connectors.map((connector) => (
            <button key={connector.id} onClick={() => connect({ connector })}
              style={{ marginRight: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
              Connect {connector.name}
            </button>
          ))}
        </div>
      ) : (
        <div>
          <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '1.5rem' }}>
            {address}
            <button onClick={() => disconnect()}
              style={{ marginLeft: '0.75rem', fontSize: '0.75rem', cursor: 'pointer' }}>
              Disconnect
            </button>
          </p>

          <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #333', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem' }}>Current count</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>
              {countLoading ? '…' : count !== undefined ? String(count) : '—'}
            </div>
            {COUNTER_ADDRESS === '0x0000000000000000000000000000000000000000' && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#c87941' }}>
                Contract not deployed yet. Ask Crucible to deploy Counter.sol.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={handleIncrement} disabled={busy}
              style={{ padding: '0.5rem 1.25rem', cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Pending…' : 'Increment'}
            </button>
            <button onClick={handleReset} disabled={busy}
              style={{ padding: '0.5rem 1.25rem', cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Pending…' : 'Reset'}
            </button>
          </div>

          {writeError && (
            <p style={{ marginTop: '0.75rem', color: '#c84141', fontSize: '0.8rem' }}>
              {writeError.message}
            </p>
          )}

          {txHash && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#888' }}>
              tx: {txHash}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
`,
  );

  await mkdir(path.join(frontendDir, 'src', 'contracts'), { recursive: true });
  await writeIfAbsent(
    path.join(frontendDir, 'src', 'contracts', 'Counter.ts'),
    `import type { Address, Abi } from 'viem';

// Update COUNTER_ADDRESS after deploying contracts/Counter.sol.
// The Crucible agent fills this in automatically after a successful deploy.
export const COUNTER_ADDRESS: Address =
  '0x0000000000000000000000000000000000000000';

export const COUNTER_ABI = [
  {
    type: 'function',
    name: 'count',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'increment',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reset',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Incremented',
    inputs: [
      { name: 'by', type: 'address', indexed: true },
      { name: 'newCount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Reset',
    inputs: [{ name: 'by', type: 'address', indexed: true }],
  },
] as const satisfies Abi;
`,
  );
}

function detectWorkspaceFileLang(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    '.sol': 'solidity',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.svelte': 'svelte',
    '.json': 'json',
    '.css': 'css',
    '.html': 'html',
    '.md': 'markdown',
    '.txt': 'plaintext',
  };
  return WorkspaceFileLangSchema.parse(byExt[ext] ?? 'plaintext');
}

/**
 * Write `content` to a workspace-relative `filePath`, creating parent
 * directories as needed.  Validates that the resolved path stays within the
 * workspace root (defense-in-depth on top of schema-level `..` blocks).
 *
 * @param overrideDir - Use this directory instead of the default
 *   `workspaceHostPath(workspaceId)`. Pass the DB-stored `directoryPath` when
 *   available so the two sources of truth stay consistent.
 */
export async function writeWorkspaceFile(
  workspaceId: string,
  filePath: string,
  content: string,
  overrideDir?: string,
): Promise<WorkspaceFile> {
  const workspaceDir = overrideDir ?? workspaceHostPath(workspaceId);
  const resolved = path.resolve(workspaceDir, filePath);

  // Path traversal guard.
  if (!resolved.startsWith(workspaceDir + path.sep) && resolved !== workspaceDir) {
    throw new Error('Path escapes the workspace directory');
  }

  await mkdir(path.dirname(resolved), { recursive: true });
  const encoded = Buffer.from(content, 'utf8');
  await writeFile(resolved, encoded);
  const fileStats = await stat(resolved);

  return {
    path: filePath,
    content,
    lang: detectWorkspaceFileLang(filePath),
    hash: createHash('sha256').update(encoded).digest('hex'),
    modifiedAt: Math.trunc(fileStats.mtimeMs),
  };
}

export async function collectWorkspaceFiles(workspaceDir: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip build-output, dependency, and version-control directories.
        if (entry.name === '.crucible' || entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStats = await stat(fullPath);
      if (fileStats.size > MAX_FILE_SIZE_BYTES) {
        continue;
      }

      const raw = await readFile(fullPath);
      files.push({
        path: path.relative(workspaceDir, fullPath).split(path.sep).join('/'),
        content: raw.toString('utf8'),
        lang: detectWorkspaceFileLang(fullPath),
        hash: createHash('sha256').update(raw).digest('hex'),
        modifiedAt: Math.trunc(fileStats.mtimeMs),
      });
    }
  }

  try {
    await walk(workspaceDir);
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
