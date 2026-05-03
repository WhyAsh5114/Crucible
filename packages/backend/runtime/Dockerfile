# Crucible per-workspace runtime image.
#
# Hosts mcp-chain (3100), mcp-compiler (3101), mcp-deployer (3102),
# mcp-wallet (3103), mcp-memory (3104), mcp-mesh (3105), mcp-terminal (3106),
# and mcp-devtools (3107) inside one container per workspace.
# Build context MUST be the monorepo root so workspace packages
# resolve correctly.
#
# Build:
#   bun run --cwd packages/backend runtime:build
#
# Or directly from the repo root:
#   docker build -t crucible-runtime:latest -f packages/backend/runtime/Dockerfile .

# ── Stage 0: Build AXL node binary ───────────────────────────────────────────
# AXL requires Go 1.25.x. We use GOTOOLCHAIN=local so the build uses whatever
# 1.25.x is installed in the golang image without trying to download 1.25.5
# from the Go toolchain server (which would add an extra network round-trip
# and could fail in air-gapped environments).
FROM golang:1.25 AS axl-builder

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/gensyn-ai/axl.git /axl

WORKDIR /axl

# GOTOOLCHAIN=local: use the installed toolchain instead of downloading go1.25.5
RUN GOTOOLCHAIN=local go build -o /axl/axl-node ./cmd/node/

# ── Stage 1: Crucible runtime base ────────────────────────────────────────────
FROM oven/bun:1.3.6 AS base

# git is required by hardhat's solc compiler downloads.
# Node.js 22 (via NodeSource) is required by Hardhat 3.x for the warm-solc step —
# the default apt nodejs package is v20 which lacks Iterator.prototype.flatMap.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace dependencies. We copy package manifests first so the
# bun install layer is cached on source-only changes.
COPY package.json bun.lock* bunfig.toml turbo.json ./
COPY tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/mcp-chain/package.json packages/mcp-chain/
COPY packages/mcp-compiler/package.json packages/mcp-compiler/
COPY packages/mcp-deployer/package.json packages/mcp-deployer/
COPY packages/mcp-wallet/package.json packages/mcp-wallet/
COPY packages/mcp-memory/package.json packages/mcp-memory/
COPY packages/mcp-mesh/package.json packages/mcp-mesh/
COPY packages/mcp-terminal/package.json packages/mcp-terminal/
COPY packages/mcp-devtools/package.json packages/mcp-devtools/
COPY packages/agent/package.json packages/agent/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
# Prisma postinstall (prisma generate) needs the schema to be present
COPY packages/backend/prisma packages/backend/prisma
COPY packages/backend/prisma.config.ts packages/backend/prisma.config.ts

RUN bun install --frozen-lockfile --ignore-scripts

# Copy source for the packages the runtime needs.
COPY packages/types ./packages/types
COPY packages/mcp-chain ./packages/mcp-chain
COPY packages/mcp-compiler ./packages/mcp-compiler
COPY packages/mcp-deployer ./packages/mcp-deployer
COPY packages/mcp-wallet ./packages/mcp-wallet
COPY packages/mcp-memory ./packages/mcp-memory
COPY packages/mcp-mesh ./packages/mcp-mesh
COPY packages/mcp-terminal ./packages/mcp-terminal
COPY packages/mcp-devtools ./packages/mcp-devtools

# Pre-warm Hardhat's solc cache so the first per-workspace compile doesn't pay
# the 30–60s download cost (and avoids racing Hardhat's MultiProcessMutex,
# which has a 60s timeout). Bakes solc 0.8.28 into /root/.cache/hardhat-nodejs/
# in this image layer; every workspace container starts with the cache primed.
#
# Use Node.js (not Bun) — Bun has a known Linux webstreams_adapters hang in
# Hardhat's fetch-based compiler downloader (same workaround as CI).
RUN cd /app/packages/mcp-compiler && node node_modules/.bin/hardhat compile

COPY --from=axl-builder /axl/axl-node /usr/local/bin/axl-node

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
    MESH_MCP_PORT=3105 \
    TERMINAL_MCP_PORT=3106 \
    DEVTOOLS_MCP_PORT=3107 \
    WORKSPACE_ROOT=/workspace \
    ALLOWED_HOSTS=host.docker.internal

EXPOSE 3100 3101 3102 3103 3104 3105 3106 3107

COPY packages/backend/runtime/entrypoint.sh /usr/local/bin/crucible-runtime-entrypoint
RUN chmod +x /usr/local/bin/crucible-runtime-entrypoint

CMD ["crucible-runtime-entrypoint"]
