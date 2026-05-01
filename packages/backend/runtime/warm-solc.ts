/**
 * Pre-warm Hardhat's solc 0.8.28 cache during runtime image build.
 *
 * Without this, the first compile inside every workspace container has to
 * download the solc binary (and the compiler-list manifest) from
 * solc-bin.ethereum.org, which can take 30–60s on slow links and races
 * Hardhat's MultiProcessMutex (60s lock timeout). We bake the cache into the
 * image once at build time so per-workspace compiles are millisecond-fast.
 *
 * Run from /app: `bun packages/backend/runtime/warm-solc.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { compileSolidity } from '../../mcp-compiler/src/compiler.ts';

const TMP_DIR = '/tmp/crucible-warm';
mkdirSync(TMP_DIR, { recursive: true });

// Hardhat walks up from the source directory looking for a package.json.
// Drop a stub so it doesn't error with PackageJsonNotFoundError.
writeFileSync(
  `${TMP_DIR}/package.json`,
  JSON.stringify({ name: 'crucible-warm', private: true, version: '0.0.0', type: 'module' }) + '\n',
  'utf8',
);

const STUB_PATH = `${TMP_DIR}/Stub.sol`;
writeFileSync(
  STUB_PATH,
  `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Stub { uint256 public x; }
`,
  'utf8',
);

console.log('[warm-solc] compiling stub to download + cache solc 0.8.28…');
const start = Date.now();
const result = await compileSolidity(STUB_PATH);
const elapsed = Date.now() - start;
if (result.errors.length > 0) {
  console.error('[warm-solc] compile errors:', result.errors);
  process.exit(1);
}
console.log(`[warm-solc] solc 0.8.28 cached (${result.contracts.length} contract, ${elapsed}ms)`);
