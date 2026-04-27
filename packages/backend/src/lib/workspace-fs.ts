import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { WorkspaceFileLangSchema, type WorkspaceFile } from '@crucible/types';

const WORKSPACES_ROOT = process.env['CRUCIBLE_WORKSPACES_ROOT'] ?? '/var/lib/crucible/workspaces';
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KiB — skip large binaries/generated files

export function workspaceHostPath(workspaceId: string): string {
  return path.join(WORKSPACES_ROOT, workspaceId);
}

export async function provisionWorkspaceDirectory(workspaceId: string): Promise<string> {
  const workspaceDir = workspaceHostPath(workspaceId);
  await mkdir(path.join(workspaceDir, 'contracts'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'frontend', 'src'), { recursive: true });
  await mkdir(path.join(workspaceDir, '.crucible'), { recursive: true });

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
    `import { http, createConfig } from 'wagmi';
import { foundry } from 'wagmi/chains';

export const config = createConfig({
  chains: [foundry],
  transports: {
    [foundry.id]: http('http://localhost:8545'),
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
    `import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>Crucible Preview</h1>
      {isConnected ? (
        <div>
          <p>Connected: {address}</p>
          {balance && (
            <p>Balance: {balance.formatted} {balance.symbol}</p>
          )}
          <button onClick={() => disconnect()}>Disconnect</button>
        </div>
      ) : (
        <div>
          {connectors.map((connector) => (
            <button key={connector.id} onClick={() => connect({ connector })}>
              Connect {connector.name}
            </button>
          ))}
        </div>
      )}
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
