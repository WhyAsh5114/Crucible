# Crucible per-workspace runtime image.
#
# Hosts mcp-chain (3100) and mcp-compiler (3101) inside one container per
# workspace. Build context MUST be the monorepo root so workspace packages
# resolve correctly.
#
# Build:
#   bun run --cwd packages/backend runtime:build
#
# Or directly from the repo root:
#   docker build -t crucible-runtime:latest -f packages/backend/runtime/Dockerfile .

FROM oven/bun:1.3.6 AS base

# git is required by hardhat's solc compiler downloads.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace dependencies. We copy package manifests first so the
# bun install layer is cached on source-only changes.
COPY package.json bun.lock* bunfig.toml turbo.json ./
COPY tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/mcp-chain/package.json packages/mcp-chain/
COPY packages/mcp-compiler/package.json packages/mcp-compiler/

RUN bun install --frozen-lockfile || bun install

# Copy source for the three packages the runtime needs.
COPY packages/types ./packages/types
COPY packages/mcp-chain ./packages/mcp-chain
COPY packages/mcp-compiler ./packages/mcp-compiler

# /workspace is the per-workspace bind mount target.
WORKDIR /workspace

# Inside the container the services bind to all interfaces so the host can
# reach them through the published port mapping. Host header validation in
# both servers is widened via ALLOWED_HOSTS.
ENV CHAIN_MCP_PORT=3100 \
    COMPILER_MCP_PORT=3101 \
    DEPLOYER_MCP_PORT=3102 \
    WALLET_MCP_PORT=3103 \
    MEMORY_MCP_PORT=3104 \
    TERMINAL_MCP_PORT=3105 \
    WORKSPACE_ROOT=/workspace \
    ALLOWED_HOSTS=host.docker.internal

EXPOSE 3100 3101 3102 3103 3104 3105

COPY packages/backend/runtime/entrypoint.sh /usr/local/bin/crucible-runtime-entrypoint
RUN chmod +x /usr/local/bin/crucible-runtime-entrypoint

CMD ["crucible-runtime-entrypoint"]
