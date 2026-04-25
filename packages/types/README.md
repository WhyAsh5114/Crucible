# @crucible/types

Frozen type contracts shared across every Crucible package. **The single source of truth for inter-package communication.**

## Design

- **Zod 4** schemas are the source of truth. All TypeScript types are inferred from them via `z.infer`.
- **viem** is the source of truth for chain primitives (`Address`, `Hash`, `Hex`, `Abi`, `TransactionReceipt`). We provide matching runtime validators (`AddressSchema`, `HashSchema`, `HexSchema`).
- **Branded string IDs.** Every domain identifier (workspace, runtime, stream, session, call, request, peer, pattern, snapshot, audit trail) is a branded string, so the type system catches accidental cross-domain ID mixing.
- **Wire-safe bigints.** EVM values that exceed `Number.MAX_SAFE_INTEGER` (gas, wei, balances) use `BigIntStringSchema` — string in JSON, `bigint` in TypeScript. Block numbers stay as `number`.
- **Discriminated unions for streams.** `AgentEvent`, `RuntimeMessage`, and `PreviewBridgeMessage` are discriminated on `type`, so consumers get exhaustive narrowing.

## Layout

| Module         | Purpose                                                                                                                                  |
| :------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `primitives`   | Branded IDs, hex/address/hash schemas, chain targets, bigint wire format                                                                 |
| `workspace`    | `WorkspaceState`, `WorkspaceFile`, `ChainState`                                                                                          |
| `api`          | HTTP request/response shapes (`/api/prompt`, `/api/workspace`, `/api/ship`, `/api/chain/fork`)                                           |
| `agent-events` | `AgentEvent` discriminated union streamed over `wss://.../ws/agent`                                                                      |
| `inference`    | Provider routing, receipt envelope, degraded-mode flag                                                                                   |
| `compiler`     | `CompiledContract`, `CompilerMessage`                                                                                                    |
| `deployer`     | `DeploymentRecord`, `TxTrace`, `DecodedCall`, `DecodedEvent`, `StorageAccess`                                                            |
| `wallet`       | `WalletAccount`, signing payloads                                                                                                        |
| `terminal`     | `TerminalSession`, terminal frame envelope                                                                                               |
| `memory`       | `MemoryPattern`, `MemoryRecallHit`, provenance                                                                                           |
| `mesh`         | `MeshPeer`, `MeshHelpRequest`, `MeshHelpResponse`                                                                                        |
| `ship`         | `ShipRequest`, `KeeperHubExecution`, ship status                                                                                         |
| `runtime`      | Control-plane ↔ workspace-runtime envelope                                                                                               |
| `preview`      | Cross-origin EIP-1193 bridge messages                                                                                                    |
| `mcp/*`        | One module per MCP server (chain, compiler, deployer, wallet, memory, mesh, terminal, ship). Each exports `tool` + input/output schemas. |

## Boundary rule

No package imports from another package's `src/`. Only the `@crucible/types` exports are crossed.
