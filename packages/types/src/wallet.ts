/**
 * Embedded dev wallet — labeled accounts pre-funded by the local Hardhat node.
 * No private keys ever appear in this contract. Signing happens on the
 * backend wallet service (see `./mcp/wallet.ts`).
 */

import { z } from 'zod';
import { AddressSchema, BigIntStringSchema } from './primitives.ts';

export const WalletAccountSchema = z.object({
  /** Human label such as `Alice`, `Bob`. Stable across chain resets. */
  label: z.string().min(1),
  address: AddressSchema,
  /** Current balance in wei. May be stale; refresh via `wallet-mcp.get_balance`. */
  balance: BigIntStringSchema,
});
export type WalletAccount = z.infer<typeof WalletAccountSchema>;
