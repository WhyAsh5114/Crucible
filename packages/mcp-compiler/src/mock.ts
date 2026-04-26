/**
 * Mock implementations for all compiler tools.
 * Used when COMPILER_MOCK=true.
 */

const MOCK_ABI: unknown[] = [
  {
    type: 'function',
    name: 'count',
    inputs: [],
    outputs: [{ type: 'uint256', name: '' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'increment',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'decrement',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reset',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

const MOCK_BYTECODE = '0x608060405234801561001057600080fd5b506101a0806100206000396000f3fe';
const MOCK_DEPLOYED_BYTECODE =
  '0x608060405234801561001057600080fd5b506004361061004c5760003560e01c8063';

export function mockCompile(sourcePath: string) {
  const name =
    sourcePath
      .split('/')
      .pop()
      ?.replace(/\.sol$/, '') ?? 'Mock';
  return {
    contracts: [
      {
        name: `${name}.sol:${name}`,
        abi: MOCK_ABI,
        bytecode: MOCK_BYTECODE,
        deployedBytecode: MOCK_DEPLOYED_BYTECODE,
      },
    ],
  };
}

export function mockGetAbi() {
  return { abi: MOCK_ABI };
}

export function mockGetBytecode() {
  return {
    bytecode: MOCK_BYTECODE,
    deployedBytecode: MOCK_DEPLOYED_BYTECODE,
  };
}

export function mockListContracts() {
  return { contracts: ['Counter.sol:Counter'] };
}
