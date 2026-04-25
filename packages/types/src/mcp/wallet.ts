/**
 * `wallet-mcp` — embedded dev wallet for the per-workspace local chain.
 */

import { z } from 'zod';
import { WalletAccountSchema } from '../wallet.ts';
import {
  AddressSchema,
  BigIntStringSchema,
  HashSchema,
  HexSchema,
} from '../primitives.ts';

export const ListAccountsInputSchema = z.object({});
export const ListAccountsOutputSchema = z.object({
  accounts: z.array(WalletAccountSchema),
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
  chainId: z.number().int().positive(),
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

export const tools = {
  list_accounts: { input: ListAccountsInputSchema, output: ListAccountsOutputSchema },
  get_balance: { input: GetBalanceInputSchema, output: GetBalanceOutputSchema },
  sign_tx: { input: SignTxInputSchema, output: SignTxOutputSchema },
  send_tx_local: { input: SendTxLocalInputSchema, output: SendTxLocalOutputSchema },
  switch_account: { input: SwitchAccountInputSchema, output: SwitchAccountOutputSchema },
} as const;
