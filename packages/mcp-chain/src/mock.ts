/**
 * Mock implementations for all chain tools.
 * Used when CHAIN_MOCK=true to allow parallel frontend/agent development
 * without a running Hardhat node.
 *
 * Note: these functions return raw wire-format objects (JSON-serialisable).
 * gasPrice is a BigInt-string, not a bigint.
 */

import { encodeBigInt } from '@crucible/types';

const MOCK_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
] as const;

let mockBlockNumber = 0;
let mockSnapshotCounter = 0;
let mockIsForked = false;
let mockForkBlock: number | undefined;
const mockSnapshots: string[] = [];

/** Reset all mock state — call from test beforeEach to guarantee isolation. */
export function resetMockState(): void {
  mockBlockNumber = 0;
  mockSnapshotCounter = 0;
  mockIsForked = false;
  mockForkBlock = undefined;
  mockSnapshots.length = 0;
}

export function mockStartNode() {
  return { rpcUrl: 'http://127.0.0.1:8545', chainId: 31337 };
}

export function mockGetState() {
  return {
    chainId: 31337,
    blockNumber: mockBlockNumber,
    gasPrice: encodeBigInt(1_000_000_000n),
    accounts: [...MOCK_ACCOUNTS],
    isForked: mockIsForked,
    ...(mockIsForked && mockForkBlock !== undefined ? { forkBlock: mockForkBlock } : {}),
    activeSnapshotIds: [...mockSnapshots],
  };
}

export function mockSnapshot() {
  const id = `0x${(++mockSnapshotCounter).toString(16)}`;
  mockSnapshots.push(id);
  return { snapshotId: id };
}

export function mockRevert(snapshotId: string) {
  const idx = mockSnapshots.indexOf(snapshotId);
  if (idx === -1) return { success: false };
  mockSnapshots.splice(idx);
  return { success: true };
}

export function mockMine(blocks: number) {
  mockBlockNumber += blocks;
  return { newBlockNumber: mockBlockNumber };
}

export function mockFork(blockNumber?: number) {
  mockIsForked = true;
  mockSnapshots.length = 0;
  mockForkBlock = blockNumber;
  return { rpcUrl: 'http://127.0.0.1:8545', chainId: 31337 };
}
