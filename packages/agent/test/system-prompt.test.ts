import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt } from '../src/system-prompt.ts';

describe('buildSystemPrompt', () => {
  test('includes empty-workspace placeholder when no files', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('(empty — no files yet)');
  });

  test('lists each file path, lang, and hash prefix', () => {
    const now = Date.now();
    const prompt = buildSystemPrompt([
      {
        path: 'contracts/Vault.sol',
        lang: 'solidity',
        hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        content: '',
        modifiedAt: now,
      },
      {
        path: 'frontend/src/App.tsx',
        lang: 'typescript',
        hash: 'deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000',
        content: '',
        modifiedAt: now,
      },
    ]);
    expect(prompt).toContain('contracts/Vault.sol');
    expect(prompt).toContain('[solidity]');
    expect(prompt).toContain('sha256:abcdef12');
    expect(prompt).toContain('frontend/src/App.tsx');
    expect(prompt).toContain('[typescript]');
    expect(prompt).toContain('sha256:deadbeef');
  });

  test('includes expected capability sections', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('write_file');
    expect(prompt).toContain('create_session');
    expect(prompt).toContain('exec');
    expect(prompt).toContain('compile');
    expect(prompt).toContain('deploy_local');
  });
});
