import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  ListAccountsInputSchema,
  GetBalanceInputSchema,
  SignTxInputSchema,
  SendTxLocalInputSchema,
  SwitchAccountInputSchema,
  type GetBalanceInput,
  type SignTxInput,
  type SendTxLocalInput,
  type SwitchAccountInput,
} from '@crucible/types/mcp/wallet';
import { createWalletService } from './service.ts';

const TAG = '[mcp-wallet]';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
const logError = (msg: string) => console.error(`${TAG} ${msg}`);

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createWalletServer(opts: {
  chainRpcUrl: string;
  workspaceRoot: string;
}): McpServer {
  const service = createWalletService(opts);
  const server = new McpServer({
    name: 'crucible-wallet',
    version: '0.0.0',
  });

  server.registerTool(
    'list_accounts',
    {
      title: 'List Dev Wallet Accounts',
      description: 'Return local chain accounts with stable labels and current balances.',
      inputSchema: ListAccountsInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        log('tool:list_accounts');
        const output = await service.listAccounts();
        log(`tool:list_accounts ok  count=${output.accounts.length}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:list_accounts error: ${String(err)}`);
        return errorResult(`list_accounts failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'get_balance',
    {
      title: 'Get Account Balance',
      description: 'Return current wei balance for a local-chain account address.',
      inputSchema: GetBalanceInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: GetBalanceInput) => {
      try {
        log(`tool:get_balance address=${input.address}`);
        const output = await service.getBalance(input);
        return toolResult(output);
      } catch (err) {
        logError(`tool:get_balance error: ${String(err)}`);
        return errorResult(`get_balance failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'sign_tx',
    {
      title: 'Sign Transaction',
      description: 'Sign a local transaction with an unlocked Hardhat test account.',
      inputSchema: SignTxInputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: SignTxInput) => {
      try {
        log(`tool:sign_tx from=${input.tx.from}`);
        const output = await service.signTx(input);
        return toolResult(output);
      } catch (err) {
        logError(`tool:sign_tx error: ${String(err)}`);
        return errorResult(`sign_tx failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'send_tx_local',
    {
      title: 'Send Signed Local Transaction',
      description: 'Sign and broadcast a local-chain transaction via eth_sendRawTransaction.',
      inputSchema: SendTxLocalInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input: SendTxLocalInput) => {
      try {
        log(`tool:send_tx_local from=${input.tx.from}`);
        const output = await service.sendTxLocal(input);
        log(`tool:send_tx_local ok  txHash=${output.txHash}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:send_tx_local error: ${String(err)}`);
        return errorResult(`send_tx_local failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'switch_account',
    {
      title: 'Switch Active Account',
      description: 'Set active wallet account label and persist it in .crucible/state.json.',
      inputSchema: SwitchAccountInputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input: SwitchAccountInput) => {
      try {
        log(`tool:switch_account label=${input.label}`);
        const output = await service.switchAccount(input);
        return toolResult(output);
      } catch (err) {
        logError(`tool:switch_account error: ${String(err)}`);
        return errorResult(`switch_account failed: ${String(err)}`);
      }
    },
  );

  // ── prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'wallet_workflow',
    {
      title: 'Dev Wallet Workflow',
      description:
        'Guide for managing local Hardhat test accounts, checking balances, and sending transactions.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are connected to the crucible-wallet MCP server.',
              'It manages the unlocked Hardhat test accounts on the local chain.',
              '',
              'Typical workflow:',
              '1. Call list_accounts to see all available accounts with labels, addresses, balances,',
              '   and the currently-active account label (activeAccountLabel field).',
              '   - Use activeAccountLabel to know which account is currently set as the sender.',
              '   - Do NOT call switch_account just to discover the current account — list_accounts',
              '     already includes it.',
              '2. Call get_balance(address) for the current wei balance of a specific address.',
              '3. Call switch_account(label) ONLY if you need to CHANGE the active account.',
              '   - switch_account is for changing the persisted label, not for reading it.',
              '   - Do NOT call it repeatedly — one call is enough.',
              '4. Call send_tx_local(tx) to sign and broadcast a transaction on the local chain.',
              '   - Required fields: from (explicit address), to, data.',
              '   - Optional fields: value (wei), gas (limit), nonce, chainId.',
              '   - chainId is OPTIONAL — the Hardhat node injects it automatically if omitted.',
              '   - from must be one of the unlocked Hardhat accounts from list_accounts.',
              '   - The "active account" from switch_account does NOT auto-fill from — always pass it.',
              '   - Returns { txHash, gasUsed, status: "success" | "reverted" }.',
              '5. Call sign_tx(tx) if you only need the signed payload without broadcasting.',
              '',
              'Tool reference:',
              '  list_accounts  — Read-only: all accounts with labels, balances, and activeAccountLabel.',
              '  get_balance    — Read-only: wei balance for one address.',
              '  switch_account — Change active account label (persisted). Do NOT use as a getter.',
              '  send_tx_local  — Sign + broadcast a local-chain transaction (from is always explicit).',
              '  sign_tx        — Sign a transaction without broadcasting.',
              '',
              'Notes:',
              '  - All accounts are Hardhat default accounts (unlocked, pre-funded with 10000 ETH).',
              '  - Balances change when you deploy contracts or send transactions.',
              '  - chainId for the local Hardhat node is 31337 if you ever need it explicitly.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'send_transaction',
    {
      title: 'Sign & Send a Local Transaction',
      description:
        'Step-by-step guide for constructing and broadcasting a transaction on the local Hardhat chain.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Sending a transaction on the local chain:',
              '',
              '1. list_accounts → pick a funded account (note its address).',
              '2. Optionally switch_account(label) to make it the active sender.',
              '3. Build the transaction object:',
              '     { from, to, data, value?, gas? }',
              '   - data is ABI-encoded calldata (use contract ABI from crucible-compiler).',
              '   - value is optional ETH to send (in wei).',
              '   - gas defaults to eth_estimateGas if omitted.',
              '4. Call send_tx_local(tx) → returns { txHash, receipt }.',
              '5. Check receipt.status: "0x1" = success, "0x0" = revert.',
              '   - On revert, use crucible-deployer simulate_local or trace to diagnose.',
              '',
              'If you only need the signed bytes (e.g. to relay later):',
              '  - Call sign_tx(tx) instead — returns { signedTx } without broadcasting.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
