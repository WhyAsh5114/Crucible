import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
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
  await mkdir(path.join(workspaceDir, 'frontend', 'public'), { recursive: true });
  await mkdir(path.join(workspaceDir, '.crucible'), { recursive: true });

  // Hardhat's `createHardhatRuntimeEnvironment` (used inside mcp-compiler)
  // walks up from the sources directory looking for a package.json and bails
  // with `PackageJsonNotFoundError` if it never finds one. The workspace
  // mount has no real npm project, so we drop a minimal stub at the root —
  // it makes Hardhat's project resolution succeed without polluting the dir
  // with anything the user needs to think about.
  await writeIfAbsent(
    path.join(workspaceDir, 'package.json'),
    `${JSON.stringify(
      { name: 'crucible-workspace', private: true, version: '0.0.0', type: 'module' },
      null,
      2,
    )}\n`,
  );

  // Write the Counter.sol contract scaffold (the agent will replace it
  // as the user builds — but the default workspace ships a working
  // contract so the wallet approval flow is testable out of the box).
  await scaffoldContracts(path.join(workspaceDir, 'contracts'));

  // Write the React + Vite + wagmi/viem template if the frontend has not yet
  // been initialised (i.e. package.json does not exist).
  await scaffoldFrontend(path.join(workspaceDir, 'frontend'));

  return workspaceDir;
}

// ---------------------------------------------------------------------------
// Counter contract scaffold
// ---------------------------------------------------------------------------

async function scaffoldContracts(contractsDir: string): Promise<void> {
  await writeIfAbsent(
    path.join(contractsDir, 'Counter.sol'),
    `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Default Crucible workspace template. Replace as you build.
contract Counter {
    uint256 public count;

    event Incremented(address indexed by, uint256 newCount);
    event Decremented(address indexed by, uint256 newCount);

    function increment() external {
        count += 1;
        emit Incremented(msg.sender, count);
    }

    function decrement() external {
        require(count > 0, "Counter: cannot go below zero");
        count -= 1;
        emit Decremented(msg.sender, count);
    }
}
`,
  );
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
import { injected } from 'wagmi/connectors';
import type { EIP1193Provider } from 'viem';
import { foundry } from 'wagmi/chains';

// Route all wagmi calls (reads AND writes) through the injected EIP-1193
// bridge so they pass through the Crucible shell's RPC proxy instead of
// hitting the Hardhat node directly (which isn't reachable from the browser).
// The bridge script (preview-bridge.js) is injected before this module by the
// Crucible launcher and locks \`window.ethereum\` to the Crucible provider.
declare global {
  interface Window {
    ethereum: EIP1193Provider;
  }
}

// Pin the connector to Crucible's RDNS so the EIP-6963 discovery picks
// exactly one provider — without this, MetaMask (or any other extension
// that announces itself) shows up alongside Crucible and the dApp ends up
// routing transactions to the wrong wallet.
export const CRUCIBLE_RDNS = 'app.crucible.preview';

// \`multiInjectedProviderDiscovery: false\` — wagmi's default behaviour is to
// auto-add every EIP-6963-announced provider as its own connector, keyed by
// rdns. The Crucible bridge announces itself with rdns 'app.crucible.preview',
// so wagmi adds it once via auto-discovery AND once via our explicit
// \`injected({ target })\` below. React then sees two connectors with the same
// id and throws "Encountered two children with the same key". Disabling
// auto-discovery makes the explicit connector the single source of truth.
export const config = createConfig({
  chains: [foundry],
  multiInjectedProviderDiscovery: false,
  connectors: [
    injected({
      target: { id: CRUCIBLE_RDNS, name: 'Crucible', provider: () => window.ethereum },
    }),
  ],
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
    `import { useEffect, useState } from 'react';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import type { Abi, Address } from 'viem';

const styles = {
  page: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    background: '#ffffff',
    color: '#0a0a0a',
    minHeight: '100vh',
    margin: 0,
    padding: '2.5rem 2rem',
  },
  card: {
    maxWidth: 520,
    margin: '0 auto',
    padding: '1.5rem',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    background: '#fafafa',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  title: { margin: 0, fontSize: '1.1rem', letterSpacing: '0.02em' },
  hint: { color: '#525252', fontSize: '0.78rem', marginTop: '0.75rem', lineHeight: 1.55 },
  label: {
    color: '#737373',
    fontSize: '0.68rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  value: { fontSize: '0.9rem', wordBreak: 'break-all' as const, marginTop: '0.15rem' },
  row: { marginTop: '1.1rem' },
  counterBox: {
    marginTop: '1.25rem',
    padding: '1rem',
    border: '1px solid #e5e5e5',
    borderRadius: 6,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
  },
  counterValue: { fontSize: '2rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const },
  button: {
    background: '#0a0a0a',
    color: '#fafafa',
    border: 'none',
    borderRadius: 6,
    padding: '0.55rem 1rem',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  buttonOutline: {
    background: 'transparent',
    color: '#0a0a0a',
    border: '1px solid #d4d4d4',
    borderRadius: 6,
    padding: '0.5rem 0.9rem',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    marginRight: '0.5rem',
  },
  txStatus: {
    marginTop: '0.75rem',
    padding: '0.55rem 0.75rem',
    background: '#f5f5f5',
    border: '1px solid #e5e5e5',
    borderRadius: 6,
    fontSize: '0.75rem',
    color: '#525252',
    wordBreak: 'break-all' as const,
  },
  error: {
    marginTop: '0.75rem',
    padding: '0.55rem 0.75rem',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    fontSize: '0.75rem',
    color: '#b91c1c',
    wordBreak: 'break-all' as const,
  },
};

function shortAddress(addr: string): string {
  return \`\${addr.slice(0, 6)}…\${addr.slice(-4)}\`;
}

interface ContractsManifest {
  counter?: { address: Address; abi: Abi; deployedAt: number };
}

/**
 * Fetch /contracts.json (written by the backend after auto-deploy) with retry
 * so the React app keeps working even if it loads before the deploy completes.
 */
function useContractsManifest(): {
  manifest: ContractsManifest | null;
  error: string | null;
} {
  const [manifest, setManifest] = useState<ContractsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(attempt: number): Promise<void> {
      try {
        const res = await fetch('/contracts.json', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        // Vite's dev server serves index.html as a SPA fallback for any
        // unknown path with status 200, so res.ok is true even when the
        // file doesn't exist yet. Detect that by checking Content-Type
        // before attempting JSON.parse.
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) {
          throw new Error('not yet deployed');
        }
        const data = (await res.json()) as ContractsManifest;
        if (cancelled) return;
        setManifest(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (attempt < 60) {
          timer = setTimeout(() => load(attempt + 1), 1000);
        } else {
          setError(err instanceof Error ? err.message : 'failed to load contracts.json');
        }
      }
    }

    void load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { manifest, error };
}

export default function App() {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance, refetch: refetchBalance } = useBalance({ address });
  const { manifest, error: manifestError } = useContractsManifest();
  const counter = manifest?.counter;

  // Auto-connect to the Crucible bridge on first load. There's only ever one
  // connector configured (filtered by RDNS in config.ts), so the user never
  // sees a wallet picker.
  useEffect(() => {
    if (status === 'disconnected' && connectors.length > 0 && !isConnecting) {
      connect({ connector: connectors[0] });
    }
  }, [status, connectors, isConnecting, connect]);

  // Read the on-chain counter value. Refetches whenever a write succeeds.
  const {
    data: count,
    refetch: refetchCount,
    isFetching: isCountLoading,
  } = useReadContract(
    counter
      ? {
          address: counter.address,
          abi: counter.abi,
          functionName: 'count',
        }
      : undefined,
  );

  const {
    writeContract,
    data: txHash,
    isPending: isSubmitting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Watch the tx through to inclusion so we know exactly when to refetch.
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (isMined) {
      void refetchCount();
      void refetchBalance();
    }
  }, [isMined, refetchCount, refetchBalance]);

  function handleIncrement() {
    if (!counter) return;
    resetWrite();
    writeContract({
      address: counter.address,
      abi: counter.abi,
      functionName: 'increment',
    });
  }

  function handleDecrement() {
    if (!counter) return;
    resetWrite();
    writeContract({
      address: counter.address,
      abi: counter.abi,
      functionName: 'decrement',
    });
  }

  const buttonLabel = isSubmitting
    ? 'Awaiting approval…'
    : isMining
      ? 'Mining…'
      : 'Increment';

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Crucible counter</h1>
        <p style={styles.hint}>
          Default workspace scaffold. Each <strong>Increment</strong> sends a real transaction
          to the deployed <code>Counter</code> contract — the Crucible wallet pane on the left
          will prompt you to approve it.
        </p>

        {isConnected && address ? (
          <>
            <div style={styles.row}>
              <div style={styles.label}>Connected account</div>
              <div style={styles.value}>{shortAddress(address)}</div>
            </div>
            <div style={styles.row}>
              <div style={styles.label}>Balance</div>
              <div style={styles.value}>
                {balance ? \`\${balance.formatted} \${balance.symbol}\` : '—'}
              </div>
            </div>
            {counter ? (
              <div style={styles.row}>
                <div style={styles.label}>Counter contract</div>
                <div style={styles.value}>{shortAddress(counter.address)}</div>
              </div>
            ) : null}

            <div style={styles.counterBox}>
              <div>
                <div style={styles.label}>Count</div>
                <div style={styles.counterValue}>
                  {counter
                    ? count !== undefined
                      ? String(count)
                      : isCountLoading
                        ? '…'
                        : '?'
                    : '—'}
                </div>
              </div>
              <div>
                <button
                  style={styles.button}
                  onClick={handleIncrement}
                  disabled={!counter || isSubmitting || isMining}
                >
                  {buttonLabel}
                </button>
                <button
                  style={{ ...styles.buttonOutline, marginLeft: '0.5rem', marginRight: 0 }}
                  onClick={handleDecrement}
                  disabled={!counter || isSubmitting || isMining || count === 0n}
                >
                  Decrement
                </button>
              </div>
            </div>

            {!counter && !manifestError ? (
              <p style={styles.hint}>Waiting for backend to deploy Counter contract…</p>
            ) : null}
            {manifestError ? (
              <div style={styles.error}>Couldn't load contracts.json: {manifestError}</div>
            ) : null}

            {txHash ? (
              <div style={styles.txStatus}>
                <div style={styles.label}>Last tx {isMining ? '(mining)' : isMined ? '(mined)' : ''}</div>
                <div>{txHash}</div>
              </div>
            ) : null}
            {writeError ? <div style={styles.error}>{writeError.message}</div> : null}

            <div style={styles.row}>
              <button style={styles.buttonOutline} onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <div style={styles.row}>
            {connectors.length === 0 ? (
              <p style={styles.hint}>
                No wallet provider detected. The Crucible bridge should auto-inject — reload the
                preview if this persists.
              </p>
            ) : (
              connectors.map((connector) => (
                <button
                  key={connector.id}
                  style={styles.button}
                  disabled={isConnecting}
                  onClick={() => connect({ connector })}
                >
                  {isConnecting ? 'Connecting…' : \`Connect \${connector.name}\`}
                </button>
              ))
            )}
            {connectError ? <div style={styles.error}>{connectError.message}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
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

  // Atomic write: temp file in the same directory, then rename over the
  // target. `fs.writeFile` truncates-then-writes, which the Vite dev server's
  // chokidar watcher can observe mid-flight — it then transforms an empty
  // file and the browser sees `NS_ERROR_CORRUPTED_CONTENT` / blank MIME.
  // POSIX rename is atomic on the directory entry, so the watcher only ever
  // sees a single complete-file event. Using the same directory avoids
  // EXDEV across mount boundaries.
  const tempPath = `${resolved}.crucible.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tempPath, encoded);
  try {
    await rename(tempPath, resolved);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
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
