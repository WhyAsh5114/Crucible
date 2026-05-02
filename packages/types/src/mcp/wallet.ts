/**
 * `wallet-mcp` — embedded dev wallet for the per-workspace local chain.
 */

import { z } from 'zod';
import { WalletAccountSchema } from '../wallet.ts';
import { AddressSchema, BigIntStringSchema, HashSchema, HexSchema } from '../primitives.ts';

export const ListAccountsInputSchema = z.object({});
export const ListAccountsOutputSchema = z.object({
  accounts: z.array(WalletAccountSchema),
  /** Label of the currently-active account (from .crucible/state.json). Null if never set. */
  activeAccountLabel: z.string().nullable(),
});
export type ListAccountsOutput = z.infer<typeof ListAccountsOutputSchema>;

export const GetBalanceInputSchema = z.object({ address: AddressSchema });
export const GetBalanceOutputSchema = z.object({ balance: BigIntStringSchema });
export type GetBalanceInput = z.infer<typeof GetBalanceInputSchema>;
export type GetBalanceOutput = z.infer<typeof GetBalanceOutputSchema>;

const TxToSignSchema = z.object({
  from: AddressSchema,
  to: AddressSchema.nullable(),
  data: HexSchema,
  value: BigIntStringSchema.optional(),
  gas: BigIntStringSchema.optional(),
  nonce: z.number().int().nonnegative().optional(),
});
export type TxToSign = z.infer<typeof TxToSignSchema>;

export const SignTxInputSchema = z.object({ tx: TxToSignSchema });
export const SignTxOutputSchema = z.object({ signedTx: HexSchema });
export type SignTxInput = z.infer<typeof SignTxInputSchema>;
export type SignTxOutput = z.infer<typeof SignTxOutputSchema>;

/** Local-chain only. The wire shape mirrors viem's `TransactionReceipt`
 *  reduced to wire-safe primitives. */
export const SendTxLocalInputSchema = z.object({ tx: TxToSignSchema });
export const SendTxLocalOutputSchema = z.object({
  txHash: HashSchema,
  gasUsed: BigIntStringSchema,
  status: z.enum(['success', 'reverted']),
});
export type SendTxLocalInput = z.infer<typeof SendTxLocalInputSchema>;
export type SendTxLocalOutput = z.infer<typeof SendTxLocalOutputSchema>;

export const SwitchAccountInputSchema = z.object({ label: z.string().min(1) });
export const SwitchAccountOutputSchema = z.object({ active: AddressSchema });
export type SwitchAccountInput = z.infer<typeof SwitchAccountInputSchema>;
export type SwitchAccountOutput = z.infer<typeof SwitchAccountOutputSchema>;

/**
 * ABI-encode calldata from a human-readable Solidity function signature + args.
 * Avoids manual selector computation (which is error-prone for the agent).
 */
export const EncodeCallInputSchema = z.object({
  /**
   * Human-readable Solidity function signature, with or without parameter names.
   * Examples: "withdraw(uint256)", "transfer(address to, uint256 amount)", "deposit()"
   * May optionally include the "function " prefix.
   */
  signature: z
    .string()
    .min(3)
    .describe(
      'Human-readable function signature, e.g. "withdraw(uint256)" or "transfer(address,uint256)"',
    ),
  /**
   * Arguments as strings, one per parameter.
   * uint/int types: decimal or 0x-prefixed hex string, e.g. "10000000000000000" or "0x2386f26fc10000"
   * address types: checksummed or lowercase hex, e.g. "0xf39Fd6e51..."
   * bool types: "true" or "false"
   * bytes/bytesN types: 0x-prefixed hex string
   * Leave empty for zero-argument functions.
   */
  args: z
    .array(z.string())
    .default([])
    .describe('Arguments as strings, one per parameter in signature order'),
});
export type EncodeCallInput = z.infer<typeof EncodeCallInputSchema>;

export const EncodeCallOutputSchema = z.object({
  /** ABI-encoded calldata hex string, including the 4-byte selector. */
  calldata: HexSchema,
});
export type EncodeCallOutput = z.infer<typeof EncodeCallOutputSchema>;

// ── High-level contract interaction (recommended) ───────────────────────────
//
// `call_contract`, `read_contract`, and `send_value` are the high-level
// entry-points the agent should use by default. They internally resolve the
// contract's ABI (via the compiler artifact store) and address (via the
// deployer's deployment registry, or an explicit override) so the caller
// never has to think about ABI selectors or calldata encoding.

/** Contract reference: either a registered contract name OR an explicit address. */
const ContractRefSchema = z
  .object({
    /** Compiled contract name (e.g. "DemoVault"). Resolved via the compiler artifact store. */
    contractName: z.string().min(1).optional(),
    /** Explicit contract address. Use this when calling a contract that wasn't deployed via deployer.deploy_local. */
    address: AddressSchema.optional(),
  })
  .refine((v) => Boolean(v.contractName || v.address), {
    message: 'Provide contractName, address, or both',
  });

export const CallContractInputSchema = z.object({
  /** Contract identification: by name (preferred) or by address. */
  contract: ContractRefSchema,
  /**
   * Function name (e.g. "deposit") or full Solidity signature (e.g. "transfer(address,uint256)").
   * If only a name is given and the ABI has multiple overloads, an error is returned.
   */
  function: z.string().min(1),
  /** Arguments as strings — same conventions as encode_call.args. */
  args: z.array(z.string()).default([]),
  /** Sender address. Defaults to the active wallet account. */
  from: AddressSchema.optional(),
  /** Optional ETH value to send (wei). */
  value: BigIntStringSchema.optional(),
  /** Optional gas limit. */
  gas: BigIntStringSchema.optional(),
});
export const CallContractOutputSchema = z.object({
  txHash: HashSchema,
  gasUsed: BigIntStringSchema,
  status: z.enum(['success', 'reverted']),
  /** Resolved address actually called (echoed for the agent's reference). */
  address: AddressSchema,
  /** Resolved canonical function signature (e.g. "deposit()"). */
  signature: z.string(),
  /** ABI-decoded revert reason if status === 'reverted'. */
  revertReason: z.string().optional(),
});
export type CallContractInput = z.infer<typeof CallContractInputSchema>;
export type CallContractOutput = z.infer<typeof CallContractOutputSchema>;

export const ReadContractInputSchema = z.object({
  contract: ContractRefSchema,
  function: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Optional caller address (some view functions may behave differently per caller). */
  from: AddressSchema.optional(),
});
export const ReadContractOutputSchema = z.object({
  /** Decoded return value. Single-output functions return a scalar JSON value;
   *  multi-output functions return an array. */
  result: z.unknown(),
  /** Raw hex returndata, for callers that want to do their own decoding. */
  raw: HexSchema,
  address: AddressSchema,
  signature: z.string(),
});
export type ReadContractInput = z.infer<typeof ReadContractInputSchema>;
export type ReadContractOutput = z.infer<typeof ReadContractOutputSchema>;

/** Pure ETH transfer with no calldata (triggers the recipient's `receive()` if it has one). */
export const SendValueInputSchema = z.object({
  to: AddressSchema,
  value: BigIntStringSchema,
  from: AddressSchema.optional(),
});
export const SendValueOutputSchema = z.object({
  txHash: HashSchema,
  gasUsed: BigIntStringSchema,
  status: z.enum(['success', 'reverted']),
});
export type SendValueInput = z.infer<typeof SendValueInputSchema>;
export type SendValueOutput = z.infer<typeof SendValueOutputSchema>;

export const tools = {
  list_accounts: { input: ListAccountsInputSchema, output: ListAccountsOutputSchema },
  get_balance: { input: GetBalanceInputSchema, output: GetBalanceOutputSchema },
  sign_tx: { input: SignTxInputSchema, output: SignTxOutputSchema },
  send_tx_local: { input: SendTxLocalInputSchema, output: SendTxLocalOutputSchema },
  switch_account: { input: SwitchAccountInputSchema, output: SwitchAccountOutputSchema },
  encode_call: { input: EncodeCallInputSchema, output: EncodeCallOutputSchema },
  call_contract: { input: CallContractInputSchema, output: CallContractOutputSchema },
  read_contract: { input: ReadContractInputSchema, output: ReadContractOutputSchema },
  send_value: { input: SendValueInputSchema, output: SendValueOutputSchema },
} as const;
