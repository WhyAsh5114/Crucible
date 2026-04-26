import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { WorkspaceFileLangSchema, type WorkspaceFile } from '@crucible/types';

const WORKSPACES_ROOT = process.env['CRUCIBLE_WORKSPACES_ROOT'] ?? '/var/lib/crucible/workspaces';

export function workspaceHostPath(workspaceId: string): string {
  return path.join(WORKSPACES_ROOT, workspaceId);
}

export async function provisionWorkspaceDirectory(workspaceId: string): Promise<string> {
  const workspaceDir = workspaceHostPath(workspaceId);
  await mkdir(path.join(workspaceDir, 'contracts'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'frontend'), { recursive: true });
  await mkdir(path.join(workspaceDir, '.crucible'), { recursive: true });
  return workspaceDir;
}

function detectWorkspaceFileLang(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    '.sol': 'solidity',
    '.ts': 'typescript',
    '.js': 'javascript',
    '.svelte': 'svelte',
    '.json': 'json',
    '.css': 'css',
    '.html': 'html',
    '.md': 'markdown',
    '.txt': 'plaintext',
  };
  return WorkspaceFileLangSchema.parse(byExt[ext] ?? 'plaintext');
}

export async function collectWorkspaceFiles(workspaceDir: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const raw = await readFile(fullPath);
      const fileStats = await stat(fullPath);
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
