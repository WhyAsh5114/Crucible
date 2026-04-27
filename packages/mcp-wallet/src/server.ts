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

  return server;
}
