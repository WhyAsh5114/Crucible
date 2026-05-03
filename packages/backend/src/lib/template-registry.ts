/**
 * Workspace template registry.
 *
 * Each template is a self-contained scaffold:
 *   - `contracts`   — Solidity sources to drop into `contracts/`.
 *   - `app`         — the React App.tsx that the preview iframe renders.
 *   - `appPageTitle` — the `<h1>` text inside the default UI.
 *   - `autoDeploy`  — what the backend's per-boot auto-deploy step compiles
 *                     and deploys (or `null` to skip — useful for templates
 *                     that interact with mainnet-forked contracts that don't
 *                     need a deploy step).
 *   - `manifestKey` — the key under which the deployed contract's address +
 *                     ABI is written to `frontend/public/contracts.json`.
 *                     The App.tsx reads this key to wire up its read/write
 *                     calls.
 *
 * The shared scaffold (vite.config.ts, tsconfig.json, index.html, main.tsx,
 * config.ts, package.json) is written by `workspace-fs.ts` regardless of
 * template choice — only the contract source and App.tsx vary. Keeps
 * branching minimal and per-template overrides obvious.
 */

import type { WorkspaceTemplate } from '@crucible/types';

export interface TemplateContract {
  /** Workspace-relative path under `contracts/`, e.g. `'DemoVault.sol'`. */
  path: string;
  /** Solidity source. */
  source: string;
}

export interface TemplateAutoDeploy {
  /** Path passed to `compiler.compile`, relative to the workspace root. */
  sourcePath: string;
  /** Contract name as it appears in the compiler output. */
  contractName: string;
  /** ABI-encoded constructor args, including any leading 0x. Defaults to '0x'. */
  constructorData: string;
  /** Friendly status string surfaced via TemplateState during boot. */
  displayName: string;
}

export interface TemplateDefinition {
  id: WorkspaceTemplate;
  /** Display name for the template picker. */
  name: string;
  /** One-line tagline shown on the picker card. */
  tagline: string;
  /** Longer description shown when the card is selected / hovered. */
  description: string;
  /** Tags shown as small badges on the card (e.g. ['Vault', 'Self-heal demo']). */
  tags: string[];
  contracts: TemplateContract[];
  /**
   * `frontend/public/contracts.json` key the deployed contract gets
   * written under. The scaffold App.tsx reads this same key to wire up
   * its read/write calls.
   */
  manifestKey: string;
  /** Auto-deploy on boot. Null for templates that don't need a local deploy. */
  autoDeploy: TemplateAutoDeploy | null;
  /** Full `frontend/src/App.tsx` content (uses the shared base styles). */
  app: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared scaffold helpers — App.tsx stylesheet + manifest-loader patterns
// ────────────────────────────────────────────────────────────────────────────

const SHARED_STYLES = `
const styles = {
  page: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    background: '#ffffff',
    color: '#0a0a0a',
    minHeight: '100vh',
    margin: 0,
    padding: '2.5rem 2rem',
  },
  card: {
    maxWidth: 560,
    margin: '0 auto',
    padding: '1.5rem',
    border: '1px solid #e5e5e5',
    borderRadius: 12,
    background: '#fafafa',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  title: { margin: 0, fontSize: '1.15rem', letterSpacing: '0.02em' },
  hint: { color: '#737373', fontSize: '0.78rem', marginTop: '0.75rem', lineHeight: 1.55 },
  label: {
    color: '#737373',
    fontSize: '0.68rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  value: { fontSize: '0.9rem', wordBreak: 'break-all' as const, marginTop: '0.15rem' },
  row: { marginTop: '1.1rem' },
  hero: {
    marginTop: '1.25rem',
    padding: '1rem',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
  },
  heroValue: {
    fontSize: '2rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  button: {
    background: '#0a0a0a',
    color: '#fafafa',
    border: 'none',
    borderRadius: 8,
    padding: '0.55rem 1rem',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  buttonOutline: {
    background: 'transparent',
    color: '#0a0a0a',
    border: '1px solid #d4d4d4',
    borderRadius: 8,
    padding: '0.5rem 0.9rem',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    cursor: 'pointer',
    marginRight: '0.5rem',
  },
  txStatus: {
    marginTop: '0.75rem',
    padding: '0.55rem 0.75rem',
    background: '#f5f5f5',
    border: '1px solid #e5e5e5',
    borderRadius: 6,
    fontSize: '0.75rem',
    color: '#525252',
    wordBreak: 'break-all' as const,
  },
  error: {
    marginTop: '0.75rem',
    padding: '0.55rem 0.75rem',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    fontSize: '0.75rem',
    color: '#b91c1c',
    wordBreak: 'break-all' as const,
  },
};

function shortAddress(addr: string): string {
  return \`\${addr.slice(0, 6)}…\${addr.slice(-4)}\`;
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Counter / DemoVault — self-heal demo.
//
// The contract is a ~140-line share-accounting ETH vault inspired by
// Uniswap V3 / ERC-4626.  The seeded bug is an off-by-one in the internal
// _accountingCheck() helper (> instead of >=).  It is intentionally placed
// inside a plausible-looking guard — not in an obviously wrong modifier — so
// the model cannot spot it from a quick source skim; it must actually attempt
// the withdrawal, hit the revert, and enter the repair loop.
// ────────────────────────────────────────────────────────────────────────────

const COUNTER_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  DemoVault
/// @notice ETH vault with Uniswap V3-inspired proportional share accounting.
///         Anyone may deposit; only the owner may withdraw. Each depositor
///         receives vault shares proportional to their ETH contribution; the
///         share model mirrors ERC-4626 so the accounting stays auditable.
///
/// @dev    Share minting: newShares = deposit * totalShares / totalAssets
///         (bootstrap: 1 share per wei on the first deposit).
///         Share burning: the internal _accountingCheck gate verifies the
///         owner holds enough shares before transferring ETH out.
contract DemoVault {
    // ── storage types ────────────────────────────────────────────────────────
    struct DepositRecord {
        uint256 shares;  // vault shares issued to this depositor
        uint128 feeTier; // fee tier at deposit time (bps; 0 = no fee)
        uint64  time;    // block.timestamp of deposit
    }

    // ── state ────────────────────────────────────────────────────────────────
    address public owner;
    uint256 public totalShares;   // Σ shares across all depositors
    uint256 public totalDeposits; // cumulative gross ETH deposited (informational)
    uint128 public feeTierBps;    // protocol fee in bps (default: 0)

    mapping(address => DepositRecord) public records;

    // ── events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed by, uint256 amount, uint256 shares, uint256 vaultBalance);
    event Withdrawn(address indexed to, uint256 amount, uint256 sharesRedeemed);
    event FeeTierSet(uint128 oldBps, uint128 newBps);

    // ── constructor ──────────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ── access control ───────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "DemoVault: caller is not owner");
        _;
    }

    // ── deposit ──────────────────────────────────────────────────────────────

    /// @notice Deposit ETH. Open to all callers. Caller receives vault shares
    ///         proportional to their contribution (1 share/wei on bootstrap).
    function deposit() external payable {
        require(msg.value > 0, "DemoVault: zero deposit");

        uint256 sharesToIssue     = _sharesFor(msg.value);
        records[msg.sender].shares  += sharesToIssue;
        records[msg.sender].feeTier  = feeTierBps;
        records[msg.sender].time     = uint64(block.timestamp);
        totalShares   += sharesToIssue;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value, sharesToIssue, address(this).balance);
    }

    // ── withdraw ─────────────────────────────────────────────────────────────

    /// @notice Withdraw \`amount\` wei to the owner. Only callable by the owner.
    ///         Passes through the share-accounting gate before sending ETH.
    function withdraw(uint256 amount) external onlyOwner {
        require(amount > 0, "DemoVault: zero amount");
        require(address(this).balance >= amount, "DemoVault: insufficient balance");

        // Share-accounting gate: ensures the shares backing \`amount\` exist.
        _accountingCheck(amount);

        uint256 sharesToBurn       = _sharesFor(amount);
        records[owner].shares     -= sharesToBurn;
        totalShares               -= sharesToBurn;

        (bool ok, ) = owner.call{ value: amount }("");
        require(ok, "DemoVault: ETH transfer failed");

        emit Withdrawn(owner, amount, sharesToBurn);
    }

    // ── admin ────────────────────────────────────────────────────────────────

    /// @notice Update the protocol fee tier in basis points (max 100 bps = 1 %).
    ///         Applied to new deposits only.
    function setFeeTier(uint128 newBps) external onlyOwner {
        require(newBps <= 100, "DemoVault: fee cap exceeded");
        emit FeeTierSet(feeTierBps, newBps);
        feeTierBps = newBps;
    }

    // ── views ────────────────────────────────────────────────────────────────

    /// @notice Convert an ETH amount to the vault-share equivalent at current prices.
    function sharesFor(uint256 ethAmount) external view returns (uint256) {
        return _sharesFor(ethAmount);
    }

    /// @notice Total vault ETH available (same as address(this).balance here).
    function totalAssets() external view returns (uint256) {
        return address(this).balance;
    }

    // ── internals ────────────────────────────────────────────────────────────

    /// @dev Returns how many shares represent \`ethAmount\` at the current price.
    ///      When the vault is empty, 1 share = 1 wei (bootstrap peg).
    function _sharesFor(uint256 ethAmount) internal view returns (uint256) {
        uint256 supply = totalShares;
        uint256 assets = address(this).balance;
        if (supply == 0 || assets == 0) return ethAmount;
        return (ethAmount * supply) / assets;
    }

    /// @dev Share-accounting gate called before every withdrawal.
    ///      Verifies the owner holds at least the shares that represent \`amount\`.
    function _accountingCheck(uint256 amount) internal view {
        uint256 sharesNeeded = _sharesFor(amount);
        uint256 ownerShares  = records[owner].shares;
        require(ownerShares > sharesNeeded, "DemoVault: share accounting failed");
        //                 ^^ seeded bug: should be >= so full-position withdrawals succeed
    }

    receive() external payable {
        if (msg.value > 0) {
            uint256 sharesToIssue      = _sharesFor(msg.value);
            records[msg.sender].shares += sharesToIssue;
            totalShares   += sharesToIssue;
            totalDeposits += msg.value;
            emit Deposited(msg.sender, msg.value, sharesToIssue, address(this).balance);
        }
    }
}
`;

const COUNTER_APP = `import { useEffect, useState } from 'react';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import type { Abi, Address } from 'viem';
${SHARED_STYLES}
interface ContractsManifest {
  vault?: { address: Address; abi: Abi; deployedAt: number };
}

function useContractsManifest(): { manifest: ContractsManifest | null; error: string | null } {
  const [manifest, setManifest] = useState<ContractsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load(attempt: number): Promise<void> {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'contracts.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.toLowerCase().includes('application/json')) throw new Error('not yet deployed');
        const data = (await res.json()) as ContractsManifest;
        if (cancelled) return;
        setManifest(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (attempt < 60) timer = setTimeout(() => load(attempt + 1), 1000);
        else setError(err instanceof Error ? err.message : 'failed');
      }
    }
    void load(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  return { manifest, error };
}

export default function App() {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletBalance, refetch: refetchWallet } = useBalance({ address });
  const { manifest, error: manifestError } = useContractsManifest();
  const vault = manifest?.vault;
  const { data: vaultBalance, refetch: refetchVault } = useBalance({ address: vault?.address });

  useEffect(() => {
    if (status === 'disconnected' && connectors.length > 0 && !isConnecting) {
      connect({ connector: connectors[0] });
    }
  }, [status, connectors, isConnecting, connect]);

  const { writeContract, data: txHash, isPending: isSubmitting, error: writeError, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => { if (isMined) { void refetchWallet(); void refetchVault(); } }, [isMined, refetchWallet, refetchVault]);

  function handleDeposit() {
    if (!vault) return;
    reset();
    writeContract({ address: vault.address, abi: vault.abi, functionName: 'deposit', value: BigInt('100000000000000000') });
  }
  function handleWithdraw() {
    if (!vault) return;
    reset();
    writeContract({ address: vault.address, abi: vault.abi, functionName: 'withdraw', args: [BigInt('100000000000000000')] });
  }

  const txLabel = isSubmitting ? 'Awaiting approval…' : isMining ? 'Mining…' : null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>DemoVault</h1>
        {isConnected && address ? (
          <>
            <div style={styles.row}><div style={styles.label}>Connected account</div><div style={styles.value}>{shortAddress(address)}</div></div>
            <div style={styles.row}><div style={styles.label}>Wallet balance</div><div style={styles.value}>{walletBalance ? \`\${walletBalance.formatted} \${walletBalance.symbol}\` : '—'}</div></div>
            {vault ? <div style={styles.row}><div style={styles.label}>Vault contract</div><div style={styles.value}>{shortAddress(vault.address)}</div></div> : null}
            <div style={styles.hero}>
              <div>
                <div style={styles.label}>Vault balance</div>
                <div style={styles.heroValue}>{vaultBalance ? vaultBalance.formatted : vault ? '…' : '—'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button style={styles.button} onClick={handleDeposit} disabled={!vault || isSubmitting || isMining}>{txLabel ?? 'Deposit 0.1 ETH'}</button>
                <button style={styles.buttonOutline} onClick={handleWithdraw} disabled={!vault || isSubmitting || isMining}>Withdraw 0.1 ETH</button>
              </div>
            </div>
            {!vault && !manifestError ? <p style={styles.hint}>Waiting for backend to deploy DemoVault contract…</p> : null}
            {manifestError ? <div style={styles.error}>Couldn't load contracts.json: {manifestError}</div> : null}
            {txHash ? <div style={styles.txStatus}><div style={styles.label}>Last tx {isMining ? '(mining)' : isMined ? '(mined)' : ''}</div><div>{txHash}</div></div> : null}
            {writeError ? <div style={styles.error}>{writeError.message}</div> : null}
            <div style={styles.row}><button style={styles.buttonOutline} onClick={() => disconnect()}>Disconnect</button></div>
          </>
        ) : (
          <div style={styles.row}>
            {connectors.length === 0 ? <p style={styles.hint}>No wallet provider detected. Reload the preview if this persists.</p> :
              connectors.map((c) => <button key={c.id} style={styles.button} disabled={isConnecting} onClick={() => connect({ connector: c })}>{isConnecting ? 'Connecting…' : \`Connect \${c.name}\`}</button>)}
            {connectError ? <div style={styles.error}>{connectError.message}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
`;

// ────────────────────────────────────────────────────────────────────────────
// NFT Mint — minimal ERC-721 with a public mint(). The contract uses a
// hand-rolled storage layout instead of OpenZeppelin so the workspace boots
// without an extra `bun install` of @openzeppelin/contracts (which slows the
// first-launch by another ~20s).
// ────────────────────────────────────────────────────────────────────────────

const NFT_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  CrucibleNFT
/// @notice Minimal hand-rolled ERC-721 with public mint. Each call mints the
///         next sequential tokenId to the caller. No URI, no approvals API
///         exposed beyond the bare minimum that wagmi's useReadContract needs.
contract CrucibleNFT {
    string public name;
    string public symbol;
    uint256 public totalSupply;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    constructor() {
        name = "Crucible NFT";
        symbol = "CRU";
    }

    /// @notice Public mint. Anyone can call; mints the next tokenId to msg.sender.
    function mint() external returns (uint256 tokenId) {
        tokenId = totalSupply;
        totalSupply += 1;
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    /// @notice Read helper: returns the count of NFTs held by \`who\`. Wagmi's
    ///         \`useReadContract\` keys re-fetches off this so the gallery
    ///         updates after each mint.
    function held(address who) external view returns (uint256) {
        return balanceOf[who];
    }
}
`;

const NFT_APP = `import { useEffect } from 'react';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import type { Abi, Address } from 'viem';
import { useState } from 'react';
${SHARED_STYLES}
interface ContractsManifest {
  nft?: { address: Address; abi: Abi; deployedAt: number };
}

function useContractsManifest(): { manifest: ContractsManifest | null; error: string | null } {
  const [manifest, setManifest] = useState<ContractsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load(attempt: number): Promise<void> {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'contracts.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.toLowerCase().includes('application/json')) throw new Error('not yet deployed');
        const data = (await res.json()) as ContractsManifest;
        if (cancelled) return;
        setManifest(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (attempt < 60) timer = setTimeout(() => load(attempt + 1), 1000);
        else setError(err instanceof Error ? err.message : 'failed');
      }
    }
    void load(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  return { manifest, error };
}

export default function App() {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { manifest, error: manifestError } = useContractsManifest();
  const nft = manifest?.nft;

  useEffect(() => {
    if (status === 'disconnected' && connectors.length > 0 && !isConnecting) {
      connect({ connector: connectors[0] });
    }
  }, [status, connectors, isConnecting, connect]);

  const { data: totalSupply, refetch: refetchSupply } = useReadContract({
    address: nft?.address,
    abi: nft?.abi,
    functionName: 'totalSupply',
    query: { enabled: !!nft },
  });
  const { data: heldByMe, refetch: refetchHeld } = useReadContract({
    address: nft?.address,
    abi: nft?.abi,
    functionName: 'held',
    args: address ? [address] : undefined,
    query: { enabled: !!nft && !!address },
  });

  const { writeContract, data: txHash, isPending: isSubmitting, error: writeError, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => { if (isMined) { void refetchSupply(); void refetchHeld(); } }, [isMined, refetchSupply, refetchHeld]);

  function handleMint() {
    if (!nft) return;
    reset();
    writeContract({ address: nft.address, abi: nft.abi, functionName: 'mint' });
  }

  const txLabel = isSubmitting ? 'Awaiting approval…' : isMining ? 'Mining…' : null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Crucible NFT</h1>
        {isConnected && address ? (
          <>
            <div style={styles.row}><div style={styles.label}>Connected account</div><div style={styles.value}>{shortAddress(address)}</div></div>
            {nft ? <div style={styles.row}><div style={styles.label}>NFT contract</div><div style={styles.value}>{shortAddress(nft.address)}</div></div> : null}
            <div style={styles.hero}>
              <div>
                <div style={styles.label}>You hold</div>
                <div style={styles.heroValue}>{heldByMe !== undefined ? String(heldByMe) : nft ? '…' : '—'}</div>
                <div style={{ ...styles.label, marginTop: '0.4rem' }}>Total minted</div>
                <div style={{ fontSize: '0.95rem', marginTop: '0.15rem' }}>{totalSupply !== undefined ? String(totalSupply) : '—'}</div>
              </div>
              <div>
                <button style={styles.button} onClick={handleMint} disabled={!nft || isSubmitting || isMining}>
                  {txLabel ?? 'Mint NFT'}
                </button>
              </div>
            </div>
            {!nft && !manifestError ? <p style={styles.hint}>Waiting for backend to deploy CrucibleNFT contract…</p> : null}
            {manifestError ? <div style={styles.error}>Couldn't load contracts.json: {manifestError}</div> : null}
            {txHash ? <div style={styles.txStatus}><div style={styles.label}>Last tx {isMining ? '(mining)' : isMined ? '(mined)' : ''}</div><div>{txHash}</div></div> : null}
            {writeError ? <div style={styles.error}>{writeError.message}</div> : null}
            <div style={styles.row}><button style={styles.buttonOutline} onClick={() => disconnect()}>Disconnect</button></div>
          </>
        ) : (
          <div style={styles.row}>
            {connectors.length === 0 ? <p style={styles.hint}>No wallet provider detected. Reload the preview if this persists.</p> :
              connectors.map((c) => <button key={c.id} style={styles.button} disabled={isConnecting} onClick={() => connect({ connector: c })}>{isConnecting ? 'Connecting…' : \`Connect \${c.name}\`}</button>)}
            {connectError ? <div style={styles.error}>{connectError.message}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Uniswap V3 — a SwapRouter wrapper. The local Hardhat node would need to be
// forked from mainnet (chain MCP supports `fork`) for the deployed Uniswap V3
// contracts to exist. We don't auto-fork on workspace boot — the agent or user
// can do it via `chain.fork`. Until forked, the swap UI shows a "fork mainnet
// first" hint instead of crashing on missing contract code.
//
// The contract is a thin "execute swap with this calldata" wrapper so the
// workspace has *something* to compile and the file tree isn't bare. The real
// action happens against Uniswap V3's deployed router on the forked chain.
// ────────────────────────────────────────────────────────────────────────────

const UNISWAP_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  SwapHelper
/// @notice Forwards calldata to the Uniswap V3 SwapRouter on a mainnet-forked
///         Hardhat node. Ask the agent to \`chain.fork\` from a mainnet RPC URL
///         first — without a fork, the SwapRouter address has no code and any
///         swap reverts.
contract SwapHelper {
    /// Uniswap V3 SwapRouter02 deployed on Ethereum mainnet at this address;
    /// available on the Hardhat fork once the chain is forked from mainnet.
    address public constant UNISWAP_V3_ROUTER = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;

    event Forwarded(address indexed caller, bytes data, uint256 valueSent);

    /// @notice Execute a raw swap by forwarding calldata to the V3 router.
    ///         Demo-only: a real integration would build calldata server-side
    ///         via Uniswap's SDK rather than accepting it from the dApp.
    function swap(bytes calldata routerCalldata) external payable returns (bytes memory) {
        emit Forwarded(msg.sender, routerCalldata, msg.value);
        (bool ok, bytes memory result) = UNISWAP_V3_ROUTER.call{ value: msg.value }(routerCalldata);
        require(ok, "SwapHelper: router call reverted");
        return result;
    }
}
`;

const UNISWAP_APP = `import { useEffect, useState } from 'react';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
} from 'wagmi';
import type { Abi, Address } from 'viem';
${SHARED_STYLES}
interface ContractsManifest {
  swap?: { address: Address; abi: Abi; deployedAt: number };
}

function useContractsManifest(): { manifest: ContractsManifest | null; error: string | null } {
  const [manifest, setManifest] = useState<ContractsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load(attempt: number): Promise<void> {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'contracts.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.toLowerCase().includes('application/json')) throw new Error('not yet deployed');
        const data = (await res.json()) as ContractsManifest;
        if (cancelled) return;
        setManifest(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (attempt < 60) timer = setTimeout(() => load(attempt + 1), 1000);
        else setError(err instanceof Error ? err.message : 'failed');
      }
    }
    void load(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  return { manifest, error };
}

export default function App() {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletBalance } = useBalance({ address });
  const { manifest, error: manifestError } = useContractsManifest();
  const swap = manifest?.swap;

  useEffect(() => {
    if (status === 'disconnected' && connectors.length > 0 && !isConnecting) {
      connect({ connector: connectors[0] });
    }
  }, [status, connectors, isConnecting, connect]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Uniswap V3 Swap</h1>
        {isConnected && address ? (
          <>
            <div style={styles.row}><div style={styles.label}>Connected account</div><div style={styles.value}>{shortAddress(address)}</div></div>
            <div style={styles.row}><div style={styles.label}>Wallet balance</div><div style={styles.value}>{walletBalance ? \`\${walletBalance.formatted} \${walletBalance.symbol}\` : '—'}</div></div>
            {swap ? <div style={styles.row}><div style={styles.label}>SwapHelper</div><div style={styles.value}>{shortAddress(swap.address)}</div></div> : null}
            <div style={styles.hero}>
              <div>
                <div style={styles.label}>Status</div>
                <div style={{ fontSize: '0.95rem', marginTop: '0.4rem' }}>
                  {swap ? 'Ask the agent to fork mainnet then swap WETH ↔ USDC.' : 'Waiting for SwapHelper to deploy…'}
                </div>
                <p style={styles.hint}>
                  Try: <em>"fork mainnet from https://eth.llamarpc.com and swap 0.01 WETH for USDC via SwapHelper"</em>
                </p>
              </div>
            </div>
            {manifestError ? <div style={styles.error}>Couldn't load contracts.json: {manifestError}</div> : null}
            <div style={styles.row}><button style={styles.buttonOutline} onClick={() => disconnect()}>Disconnect</button></div>
          </>
        ) : (
          <div style={styles.row}>
            {connectors.length === 0 ? <p style={styles.hint}>No wallet provider detected. Reload the preview if this persists.</p> :
              connectors.map((c) => <button key={c.id} style={styles.button} disabled={isConnecting} onClick={() => connect({ connector: c })}>{isConnecting ? 'Connecting…' : \`Connect \${c.name}\`}</button>)}
            {connectError ? <div style={styles.error}>{connectError.message}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
`;

// ────────────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────────────

export const TEMPLATES: Record<WorkspaceTemplate, TemplateDefinition> = {
  counter: {
    id: 'counter',
    name: 'Vault (Self-heal demo)',
    tagline: 'Share-accounting ETH vault with a deliberately seeded bug.',
    description:
      'A DemoVault contract with Uniswap V3-inspired share accounting and a subtle off-by-one in the withdrawal gate. Deposit succeeds; withdraw reverts — watch the agent trace the EVM, patch the source, recompile, and redeploy automatically.',
    tags: ['Solidity', 'Self-heal demo', 'ERC-4626'],
    contracts: [{ path: 'DemoVault.sol', source: COUNTER_CONTRACT }],
    manifestKey: 'vault',
    autoDeploy: {
      sourcePath: 'contracts/DemoVault.sol',
      contractName: 'DemoVault',
      constructorData: '0x',
      displayName: 'DemoVault',
    },
    app: COUNTER_APP,
  },
  'uniswap-v3': {
    id: 'uniswap-v3',
    name: 'Uniswap V3 Swap',
    tagline: 'Swap WETH ↔ USDC on a Hardhat fork of mainnet.',
    description:
      'A SwapHelper contract that forwards calls to the Uniswap V3 SwapRouter. Ask the agent to fork mainnet (any public RPC works) and the same V3 contracts you use on production are available locally.',
    tags: ['Uniswap V3', 'Mainnet fork', 'Advanced'],
    contracts: [{ path: 'SwapHelper.sol', source: UNISWAP_CONTRACT }],
    manifestKey: 'swap',
    autoDeploy: {
      sourcePath: 'contracts/SwapHelper.sol',
      contractName: 'SwapHelper',
      constructorData: '0x',
      displayName: 'SwapHelper',
    },
    app: UNISWAP_APP,
  },
  'nft-mint': {
    id: 'nft-mint',
    name: 'NFT Mint',
    tagline: 'Minimal ERC-721 with a public mint button.',
    description:
      'A hand-rolled ERC-721 (`CrucibleNFT`) with a public `mint()` and a frontend that shows total supply + your holdings. The simplest "press a button → real on-chain transaction → balance updates" demo.',
    tags: ['ERC-721', 'NFT', 'Quick start'],
    contracts: [{ path: 'CrucibleNFT.sol', source: NFT_CONTRACT }],
    manifestKey: 'nft',
    autoDeploy: {
      sourcePath: 'contracts/CrucibleNFT.sol',
      contractName: 'CrucibleNFT',
      constructorData: '0x',
      displayName: 'CrucibleNFT',
    },
    app: NFT_APP,
  },
};

/**
 * Resolve a template by id with a safe fallback. Old workspaces created
 * before the column existed end up reading `'counter'` from the DB default,
 * so this always returns a definition.
 */
export function resolveTemplate(id: string | null | undefined): TemplateDefinition {
  if (id && id in TEMPLATES) return TEMPLATES[id as WorkspaceTemplate];
  return TEMPLATES.counter;
}
