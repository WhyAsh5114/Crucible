import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import {
  WorkspaceFileLangSchema,
  type WorkspaceFile,
  type WorkspaceTemplate,
} from '@crucible/types';
import { resolveTemplate } from './template-registry';

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

export async function provisionWorkspaceDirectory(
  workspaceId: string,
  template: WorkspaceTemplate = 'counter',
): Promise<string> {
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

  // Template-specific contract source(s). The shared scaffold (frontend
  // boilerplate) is template-agnostic and gets dropped below; only the
  // contract files and the App.tsx vary by template.
  const def = resolveTemplate(template);
  for (const c of def.contracts) {
    await writeIfAbsent(path.join(workspaceDir, 'contracts', c.path), c.source);
  }

  // Common frontend scaffold (vite/tsconfig/index.html/main.tsx/config.ts/package.json),
  // followed by the template-specific App.tsx.
  await scaffoldFrontend(path.join(workspaceDir, 'frontend'), def.app);

  return workspaceDir;
}

// ---------------------------------------------------------------------------
// React + Vite + wagmi/viem scaffold (template-agnostic boilerplate)
// ---------------------------------------------------------------------------

async function writeIfAbsent(filePath: string, content: string): Promise<void> {
  try {
    await stat(filePath); // exists → skip
  } catch {
    await writeFile(filePath, content, 'utf8');
  }
}

async function scaffoldFrontend(frontendDir: string, appSource: string): Promise<void> {
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
  server: {
    strictPort: true,
    // Crucible's backend writes files via atomic temp-file + rename so the
    // dev server never observes a half-written module mid-flight. The
    // tradeoff is that inotify/fsevents on bind-mounted dirs sometimes miss
    // the rename event entirely, so HMR silently doesn't fire after a save.
    // Polling sidesteps this by stat-checking files at a steady cadence —
    // ~1–2% CPU for a deterministic reload signal.
    watch: {
      usePolling: true,
      interval: 200,
    },
  },
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

  await writeIfAbsent(path.join(frontendDir, 'src', 'App.tsx'), appSource);
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
