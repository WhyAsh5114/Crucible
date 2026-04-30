/**
 * `deployer-mcp` — local-chain deploy, simulate, trace, call.
 *
 * Public-chain executions go through KeeperHub (see `./ship.ts`). Nothing in
 * this server is allowed to talk to a public RPC.
 */

import { z } from 'zod';
import { TxTraceSchema } from '../deployer.ts';
import { AddressSchema, BigIntStringSchema, HashSchema, HexSchema } from '../primitives.ts';

const TxRequestSchema = z.object({
  from: AddressSchema.optional(),
  to: AddressSchema.nullable(),
  data: HexSchema,
  value: BigIntStringSchema.optional(),
  gas: BigIntStringSchema.optional(),
});
export type TxRequest = z.infer<typeof TxRequestSchema>;

/**
 * Deploy by compiled contract name — bytecode is auto-fetched from mcp-compiler.
 * Run compile first, then pass the contract name here.
 */
export const DeployLocalInputSchema = z.object({
  /** Compiled contract name (e.g. "Counter"). Compile first via compiler-mcp. */
  contractName: z.string().min(1),
  /** Encoded constructor calldata appended to the bytecode. May be empty `0x`. */
  constructorData: HexSchema,
  sender: AddressSchema.optional(),
  value: BigIntStringSchema.optional(),
});

export const DeployLocalOutputSchema = z.object({
  address: AddressSchema,
  txHash: HashSchema,
  gasUsed: BigIntStringSchema,
});
export type DeployLocalInput = z.infer<typeof DeployLocalInputSchema>;
export type DeployLocalOutput = z.infer<typeof DeployLocalOutputSchema>;

export const SimulateLocalInputSchema = z.object({ tx: TxRequestSchema });
export const SimulateLocalOutputSchema = z.object({
  result: HexSchema,
  gasEstimate: BigIntStringSchema,
  /** Decoded revert reason, when the simulation reverted. */
  revertReason: z.string().optional(),
  /** Raw event log entries, undecoded. Decoding happens at the inspector. */
  logs: z.array(
    z.object({
      address: AddressSchema,
      topics: z.array(HashSchema),
      data: HexSchema,
    }),
  ),
});
export type SimulateLocalInput = z.infer<typeof SimulateLocalInputSchema>;
export type SimulateLocalOutput = z.infer<typeof SimulateLocalOutputSchema>;

export const TraceInputSchema = z.object({ txHash: HashSchema });
export const TraceOutputSchema = TxTraceSchema;
export type TraceInput = z.infer<typeof TraceInputSchema>;
export type TraceOutput = z.infer<typeof TraceOutputSchema>;

export const CallInputSchema = z.object({
  to: AddressSchema,
  /** ABI-encoded calldata. */
  data: HexSchema,
  from: AddressSchema.optional(),
});
export const CallOutputSchema = z.object({ result: HexSchema });
export type CallInput = z.infer<typeof CallInputSchema>;
export type CallOutput = z.infer<typeof CallOutputSchema>;

/**
 * Deploy a compiled contract to the 0G Galileo testnet (chainId 16602).
 *
 * Uses the deployer node's `OG_DEPLOY_PRIVATE_KEY` to sign and broadcast
 * a real on-chain creation transaction via the 0G EVM RPC endpoint.
 * Bytecode is auto-fetched from mcp-compiler by `contractName`.
 */
export const DeployOgChainInputSchema = z.object({
  /** Compiled contract name (e.g. "Counter"). Compile first via compiler-mcp. */
  contractName: z.string().min(1),
  /** Encoded constructor calldata appended to the bytecode. May be empty `0x`. */
  constructorData: HexSchema,
  /** Optional native-token (OG) value to send with the deployment, in wei. */
  value: BigIntStringSchema.optional(),
});

export const DeployOgChainOutputSchema = z.object({
  address: AddressSchema,
  txHash: HashSchema,
  gasUsed: BigIntStringSchema,
  /** 0G Chainscan URL for the deployment transaction. */
  explorerUrl: z.string().url(),
});
export type DeployOgChainInput = z.infer<typeof DeployOgChainInputSchema>;
export type DeployOgChainOutput = z.infer<typeof DeployOgChainOutputSchema>;

export const tools = {
  deploy_local: { input: DeployLocalInputSchema, output: DeployLocalOutputSchema },
  simulate_local: { input: SimulateLocalInputSchema, output: SimulateLocalOutputSchema },
  trace: { input: TraceInputSchema, output: TraceOutputSchema },
  call: { input: CallInputSchema, output: CallOutputSchema },
  deploy_0g_chain: { input: DeployOgChainInputSchema, output: DeployOgChainOutputSchema },
} as const;
