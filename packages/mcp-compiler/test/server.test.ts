/**
 * Tests for the compiler MCP server factory.
 */

import { describe, it, expect } from 'bun:test';
import { createCompilerServer } from '../src/server.ts';
import { CompileInputSchema } from '@crucible/types/mcp/compiler';

// ── Server factory ─────────────────────────────────────────────────────────

describe('createCompilerServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createCompilerServer({ workspaceRoot: '/tmp' })).not.toThrow();
  });
});

// ── CompileInputSchema — mutual exclusion ──────────────────────────────────

describe('CompileInputSchema', () => {
  it('accepts sourcePath alone', () => {
    const result = CompileInputSchema.safeParse({ sourcePath: '/workspace/Counter.sol' });
    expect(result.success).toBe(true);
  });

  it('accepts source alone', () => {
    const result = CompileInputSchema.safeParse({
      source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A {}',
    });
    expect(result.success).toBe(true);
  });

  it('accepts source with an explicit fileName', () => {
    const result = CompileInputSchema.safeParse({
      source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A {}',
      fileName: 'MyToken.sol',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when both sourcePath and source are provided', () => {
    const result = CompileInputSchema.safeParse({
      sourcePath: '/workspace/Counter.sol',
      source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A {}',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when neither sourcePath nor source are provided', () => {
    const result = CompileInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a fileName that does not end in .sol', () => {
    const result = CompileInputSchema.safeParse({
      source: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A {}',
      fileName: 'Token.ts',
    });
    expect(result.success).toBe(false);
  });
});
