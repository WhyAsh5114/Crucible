# Crucible per-workspace runtime container.

This image hosts the workspace-scoped MCP services (`mcp-chain`, `mcp-compiler`) for one workspace at a time. The control plane (`@crucible/backend`) launches one container per workspace, captures the host-side ports for each service, and proxies `tool_exec` requests to them over HTTP.

## Build

```sh
# From the repo root (preferred — keeps the build context small):
docker build -t crucible-runtime:latest -f packages/backend/runtime/Dockerfile .

# Or via the backend package script:
bun run --cwd packages/backend runtime:build
```

## Configuration

Inside the container the services bind to the conventional ports:

- `mcp-chain` → `3100`
- `mcp-compiler` → `3101`

The control plane publishes both ports with dynamic host port assignment and discovers them via `docker inspect`. There is no requirement for the host ports to match the in-container ports.

The bind/volume mount target is `/workspace`. Files written by the agent on the host appear inside the container at the same path.

## Health

A workspace runtime is considered ready when both services respond:

- `GET http://<host>:<chainPort>/state` → `200`
- `GET http://<host>:<compilerPort>/contracts` → `200`

The control plane probes both endpoints during `open_workspace` and only flips the runtime descriptor to `ready` once both succeed.
