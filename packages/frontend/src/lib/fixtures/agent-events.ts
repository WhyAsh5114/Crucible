/**
 * Canned `AgentEvent` fixtures for Phase 0/1 — drive the UI before any real
 * backend exists. Sequence simulates the build → break → heal → done arc:
 * thinking → tool_call (compile) → tool_result → file_write → tool_call
 * (deploy) → tool_result → revert_detected → patch_proposed → patch_verified
 * → done.
 *
 * Event ordering uses monotonic `seq` per `streamId`; `emittedAt` is a fixed
 * baseline so renderers can format relative timestamps deterministically.
 */

import { CallIdSchema, HashSchema, StreamIdSchema, type AgentEvent } from '@crucible/types';

const STREAM_ID = StreamIdSchema.parse('demo-stream-1');
const T0 = 1735689600000; // 2025-01-01T00:00:00Z, deterministic baseline

const compileCallId = CallIdSchema.parse('call-compile-1');
const deployCallId = CallIdSchema.parse('call-deploy-1');
const failingTxHash = HashSchema.parse('0x' + 'a1b2c3d4'.repeat(8));
const localReceipt = HashSchema.parse('0x' + '7e57'.repeat(16));

/** sha256-shaped hex; 64 lowercase hex chars. Deterministic, not real. */
const fakeHash = (seed: string): string => {
	const base = seed.padEnd(8, '0').slice(0, 8);
	return base.repeat(8).slice(0, 64);
};

export const fixtureAgentEvents: AgentEvent[] = [
	{
		streamId: STREAM_ID,
		seq: 0,
		emittedAt: T0,
		type: 'thinking',
		text: 'Reading workspace state and planning the contract layout.'
	},
	{
		streamId: STREAM_ID,
		seq: 1,
		emittedAt: T0 + 700,
		type: 'thinking',
		text: 'A 24h withdraw cooldown needs a per-account `lastDepositAt` and a `WITHDRAW_COOLDOWN` constant.'
	},
	{
		streamId: STREAM_ID,
		seq: 2,
		emittedAt: T0 + 1400,
		type: 'file_write',
		path: 'contracts/Vault.sol',
		lang: 'solidity',
		hash: fakeHash('vault01')
	},
	{
		streamId: STREAM_ID,
		seq: 3,
		emittedAt: T0 + 2000,
		type: 'tool_call',
		callId: compileCallId,
		tool: 'compiler.compile',
		args: { path: 'contracts/Vault.sol' }
	},
	{
		streamId: STREAM_ID,
		seq: 4,
		emittedAt: T0 + 2900,
		type: 'tool_result',
		callId: compileCallId,
		outcome: {
			ok: true,
			result: { contracts: ['Vault'], warnings: [] }
		}
	},
	{
		streamId: STREAM_ID,
		seq: 5,
		emittedAt: T0 + 3300,
		type: 'tool_call',
		callId: deployCallId,
		tool: 'deployer.deploy_local',
		args: { contract: 'Vault', constructorArgs: [] }
	},
	{
		streamId: STREAM_ID,
		seq: 6,
		emittedAt: T0 + 4100,
		type: 'tool_result',
		callId: deployCallId,
		outcome: {
			ok: true,
			result: {
				address: '0xDEADbEefDeadbeefdeAdbeEfDEadbeefDEadBEef',
				gasUsed: '482311'
			}
		}
	},
	{
		streamId: STREAM_ID,
		seq: 7,
		emittedAt: T0 + 5200,
		type: 'revert_detected',
		txHash: failingTxHash,
		revertSignature: 'WithdrawCooldownActive(address account, uint256 unlocksAt)'
	},
	{
		streamId: STREAM_ID,
		seq: 8,
		emittedAt: T0 + 6100,
		type: 'patch_proposed',
		source: 'memory',
		patch: `--- a/contracts/Vault.sol
+++ b/contracts/Vault.sol
@@ -42,7 +42,7 @@
     function withdraw(uint256 amount) external {
-        require(block.timestamp >= lastDepositAt[msg.sender] + 1 days, "cooldown");
+        if (block.timestamp < lastDepositAt[msg.sender] + WITHDRAW_COOLDOWN) {
+            revert WithdrawCooldownActive(msg.sender, lastDepositAt[msg.sender] + WITHDRAW_COOLDOWN);
+        }
         _burn(msg.sender, amount);
`
	},
	{
		streamId: STREAM_ID,
		seq: 9,
		emittedAt: T0 + 7000,
		type: 'patch_verified',
		localReceipt
	},
	{
		streamId: STREAM_ID,
		seq: 10,
		emittedAt: T0 + 7400,
		type: 'done'
	}
];
