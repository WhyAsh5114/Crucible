import { describe, it, expect } from 'bun:test';
import { appendPendingOutput, getOrCreatePtySession } from '../src/lib/pty-manager';

describe('appendPendingOutput', () => {
  it('accumulates output when the buffer is still empty', () => {
    expect(appendPendingOutput('', 'hello')).toBe('hello');
    expect(appendPendingOutput('hello', ' world')).toBe('hello world');
  });

  it('keeps only the most recent buffered output when the limit is exceeded', () => {
    const oversized = 'a'.repeat(70_000);
    const buffered = appendPendingOutput('', oversized);

    expect(buffered.length).toBe(64 * 1024);
    expect(buffered).toBe(oversized.slice(-64 * 1024));
  });
});

describe('getOrCreatePtySession', () => {
  it('refuses to spawn when the runner container is not running', async () => {
    // Use an obviously-non-existent workspace id; runtime-docker will treat
    // it as `missing` and the manager must throw before any DB write.
    const id = `nonexistent-${Date.now()}`;
    await expect(getOrCreatePtySession(id)).rejects.toThrow(/not running/);
  });
});
