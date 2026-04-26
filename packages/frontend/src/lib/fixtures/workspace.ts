/**
 * Canned `WorkspaceState` for Phase 0/1 — the UI gets a believable workspace
 * to render against without any real backend. Mirrors what the backend will
 * eventually return from `GET /api/workspace/:id`.
 */

import { WorkspaceIdSchema, type WorkspaceState } from '@crucible/types';

const fakeHash = (seed: string): string => {
	const base = seed.padEnd(8, '0').slice(0, 8);
	return base.repeat(8).slice(0, 64);
};

const VAULT_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Vault {
    error WithdrawCooldownActive(address account, uint256 unlocksAt);

    uint256 public constant WITHDRAW_COOLDOWN = 24 hours;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public lastDepositAt;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        lastDepositAt[msg.sender] = block.timestamp;
    }

    function withdraw(uint256 amount) external {
        if (block.timestamp < lastDepositAt[msg.sender] + WITHDRAW_COOLDOWN) {
            revert WithdrawCooldownActive(
                msg.sender,
                lastDepositAt[msg.sender] + WITHDRAW_COOLDOWN
            );
        }
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }
}
`;

const APP_SVELTE = `<script lang="ts">
    let amount = $state('0');
</script>

<main class="p-6">
    <h1>Vault</h1>
    <input bind:value={amount} type="number" />
    <button>Deposit</button>
    <button>Withdraw</button>
</main>
`;

export const fixtureWorkspaceState: WorkspaceState = {
	id: WorkspaceIdSchema.parse('vault-demo'),
	name: 'Vault demo',
	createdAt: 1735689600000,
	chainState: null,
	deployments: [],
	files: [
		{
			path: 'contracts/Vault.sol',
			content: VAULT_SOL,
			lang: 'solidity',
			hash: fakeHash('vault01'),
			modifiedAt: 1735689601400
		},
		{
			path: 'frontend/src/App.svelte',
			content: APP_SVELTE,
			lang: 'svelte',
			hash: fakeHash('app01'),
			modifiedAt: 1735689601800
		}
	],
	previewUrl: null,
	terminalSessionId: null
};
