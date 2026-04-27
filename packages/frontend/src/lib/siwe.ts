/**
 * Sign-in with Ethereum flow.
 *
 * Drives an injected EIP-1193 provider (MetaMask, Rabby, etc.) through:
 *   1. eth_requestAccounts        — get an address
 *   2. authClient.siwe.nonce()    — server-issued single-use nonce
 *   3. createSiweMessage          — EIP-4361 message bound to our domain
 *   4. personal_sign              — wallet prompts the user for a signature
 *   5. authClient.siwe.verify()   — server validates and starts a session
 *
 * Errors are wrapped so the caller can render them directly without
 * leaking provider-specific stack traces.
 */

import { createSiweMessage } from 'viem/siwe';
import { authClient } from './auth-client';

type Eip1193Provider = {
	request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
};

type WindowWithEthereum = Window & typeof globalThis & { ethereum?: Eip1193Provider };

export class SiweError extends Error {
	constructor(
		public readonly code:
			| 'no_provider'
			| 'no_account'
			| 'user_rejected'
			| 'nonce_failed'
			| 'sign_failed'
			| 'verify_failed',
		message: string
	) {
		super(message);
		this.name = 'SiweError';
	}
}

function getProvider(): Eip1193Provider {
	const ethereum = (window as WindowWithEthereum).ethereum;
	if (!ethereum) {
		throw new SiweError(
			'no_provider',
			'No Ethereum wallet detected. Install MetaMask or another EIP-1193 wallet to continue.'
		);
	}
	return ethereum;
}

async function requestAccount(provider: Eip1193Provider): Promise<`0x${string}`> {
	let accounts: string[];
	try {
		accounts = await provider.request<string[]>({ method: 'eth_requestAccounts' });
	} catch (err) {
		// EIP-1193 user rejection is code 4001.
		const code = (err as { code?: number }).code;
		if (code === 4001) {
			throw new SiweError('user_rejected', 'Wallet connection request was rejected.');
		}
		throw new SiweError('no_account', `Wallet refused to share an account: ${formatErr(err)}`);
	}
	const first = accounts[0];
	if (!first) throw new SiweError('no_account', 'Wallet returned no accounts.');
	return first as `0x${string}`;
}

async function readChainId(provider: Eip1193Provider): Promise<number> {
	try {
		const hex = await provider.request<string>({ method: 'eth_chainId' });
		return Number.parseInt(hex, 16);
	} catch {
		// Default to mainnet if the wallet refuses; SIWE only needs *some* chainId.
		return 1;
	}
}

function formatErr(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	return 'unknown error';
}

/**
 * Run the full SIWE flow against the connected injected wallet. Resolves
 * once the better-auth server has accepted the signature and set the
 * session cookie; the caller should then refresh `useSession()`.
 */
export async function signInWithEthereum(): Promise<void> {
	const provider = getProvider();
	const address = await requestAccount(provider);
	const chainId = await readChainId(provider);

	const nonceRes = await authClient.siwe.nonce({ walletAddress: address, chainId });
	if (nonceRes.error || !nonceRes.data?.nonce) {
		throw new SiweError(
			'nonce_failed',
			nonceRes.error?.message ?? 'Failed to fetch SIWE nonce from server.'
		);
	}

	const message = createSiweMessage({
		address,
		chainId,
		domain: window.location.host,
		nonce: nonceRes.data.nonce,
		uri: window.location.origin,
		version: '1',
		issuedAt: new Date(),
		statement: 'Sign in to Crucible'
	});

	let signature: `0x${string}`;
	try {
		signature = await provider.request<`0x${string}`>({
			method: 'personal_sign',
			params: [message, address]
		});
	} catch (err) {
		const code = (err as { code?: number }).code;
		if (code === 4001) {
			throw new SiweError('user_rejected', 'Signature request was rejected.');
		}
		throw new SiweError('sign_failed', `Wallet failed to sign: ${formatErr(err)}`);
	}

	const verifyRes = await authClient.siwe.verify({
		message,
		signature,
		walletAddress: address,
		chainId
	});

	if (verifyRes.error || !verifyRes.data?.success) {
		throw new SiweError(
			'verify_failed',
			verifyRes.error?.message ?? 'Server rejected the SIWE signature.'
		);
	}
}
