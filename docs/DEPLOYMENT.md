# Deployment — Simple Live Architecture, Docker Strategy & Hosting Plan

> Goal: make Crucible deployable for real testers without changing the product model. The runtime should work on a single powerful laptop now, and move to AWS later with the same container images.

---

## Recommended Live Architecture

For **public live testing**, the simplest architecture that is still sane is:

1. **Gateway** container
2. **Control plane** container
3. **One workspace runner container per active workspace**
4. **Persistent host volume** for workspace data and metadata
5. **One AXL node sidecar** per Crucible deployment
6. **Cloudflare Tunnel** when hosting from the home laptop

This keeps the product simple, but avoids the biggest flaw in the earlier model: letting arbitrary prompt-generated code run directly inside the main app process on your host.

---

## Why This Is the Right Shape

There are really two deployment modes:

### Mode A — Trusted Demo / Internal Testing

Run everything inside one stateful backend process that spawns per-workspace child processes.

This is fine for:
- local development
- demo recordings
- trusted testers
- a single operator laptop

This is **not** ideal for open public access, because the agent, preview server, terminal, and generated code all share the same backend trust boundary.

### Mode B — Public Live Testing

Use a **control plane + isolated workspace runners**.

This is the recommended architecture for your laptop-hosted beta and for AWS later.

- The **control plane** handles auth, sessions, agent orchestration, API routes, WebSockets, and external integrations.
- The **workspace runner** handles the risky per-workspace runtime: Hardhat, preview server, PTY, generated files, compiler artifacts.

This lets you keep the UX identical while moving the dangerous code execution boundary out of the main app.

---

## Component Breakdown

| Component | Runs where | Responsibility |
| :--- | :--- | :--- |
| **Gateway** | Container | TLS termination, HTTP/WebSocket proxying, routing to main app and workspace previews |
| **Control plane** | Container | Frontend shell, API, auth, workspace metadata, agent orchestration, MCP coordination, 0G + KeeperHub clients |
| **AXL node** | Sidecar container | One node per Crucible deployment for peer communication |
| **Workspace runner** | One container per active workspace | Hardhat node, preview server, PTY shell, file storage, compile/deploy loop |
| **Persistent volume** | Host disk / mounted volume | Workspace files, artifacts, logs, metadata |
| **Cloudflare Tunnel** | Optional container on laptop | Public ingress from the internet to the home-hosted stack |

---

## Recommended Data Placement

| Data | Storage location | Notes |
| :--- | :--- | :--- |
| Workspace source code | Persistent host volume | Mounted into the runner container |
| Compiler artifacts | Persistent host volume | Stored under workspace `.crucible/artifacts/` |
| Deployment metadata | Persistent host volume | Stored under workspace `.crucible/state.json` |
| Terminal logs | Persistent host volume | Stored under workspace `.crucible/logs/` |
| Session metadata | SQLite on host volume | Good enough for a single-host MVP |
| Agent memory / verified fixes | 0G Storage | Cross-session, cross-node memory |
| Public-chain execution trail | KeeperHub | External provenance system |

For the MVP, **SQLite + filesystem** is the right choice. Do not add Postgres unless you genuinely outgrow it.

---

## Inference Budget and Fallback Strategy

0G Compute is the only sponsor integration here with obvious variable spend and rate-limit risk, so the runtime should treat it as the **primary but scarce** resource.

### Provider Policy

- **Primary provider:** 0G Compute
- **Fallback provider:** OpenAI-compatible endpoint such as OpenRouter
- **Memory remains on 0G Storage either way**

The fallback is there to prevent the product from becoming unusable during testing if:

- 0G returns `429 Too Many Requests`
- the funded 0G balance is exhausted
- the chosen provider is temporarily unavailable
- an admin explicitly enables degraded mode

### Non-Negotiable Rule

Fallback must be **visible and honest**.

If the agent uses OpenRouter, the UI should say so. Do not render a fake 0G receipt or imply the request was handled by 0G.

### Recommended Controls

- Per-user prompt rate limit
- Per-user daily inference budget
- Admin kill switch for fallback
- `DEMO_MODE_0G_ONLY=true` for the judged recording unless emergency failover is required
- Restrict high-cost agent actions in public beta

### Suggested Environment Variables

```text
INFERENCE_PRIMARY=0g
INFERENCE_FALLBACK=openrouter
ENABLE_INFERENCE_FALLBACK=true
DEMO_MODE_0G_ONLY=false
FALLBACK_ON_429=true
FALLBACK_ON_0G_BALANCE_LOW=true
```

---

## Public URL Layout

### Local Development

Use Portless:

- `https://crucible.localhost`
- `https://preview.<workspace-id>.crucible.localhost`

### Public Deployment

Use a real domain:

- `https://crucible.yourdomain.com` — main app
- `https://preview-<workspace-id>.crucible.yourdomain.com` — per-workspace preview
- `wss://crucible.yourdomain.com/ws/*` — agent, terminal, RPC WebSockets

The preview uses its own subdomain because that is the easiest way to keep dev-server behavior normal. Path-based preview proxying is possible, but it complicates asset paths, HMR, and websocket routing for little benefit.

---

## User Request Flow in Production

This is how the hosted version works technically.

### 1. User opens the site

Flow:
- Browser hits `crucible.yourdomain.com`
- Gateway forwards to control plane
- Control plane serves the frontend shell
- Browser opens persistent WebSocket connections back to control plane

### 2. User creates or opens a workspace

Flow:
- Control plane creates a workspace record in SQLite
- Control plane creates a workspace directory on the persistent volume
- Control plane starts a new workspace runner container if one is not already running
- Runner mounts that workspace directory
- Runner starts Hardhat, PTY session, and preview server
- Control plane returns `previewUrl`, `terminalSessionId`, and workspace file list

### 3. User prompts the agent

Flow:
- Browser posts prompt to control plane
- Control plane sends prompt + workspace context into the agent loop
- Agent calls the inference router: 0G first, OpenAI-compatible fallback only when degraded-mode conditions are met
- Agent uses MCP tools to write files, compile, deploy, trace, and narrate progress
- Those actions target the workspace runner, not the host machine directly

### 4. User sees code and preview update

Flow:
- Agent writes files into the mounted workspace volume
- Runner compiles and deploys locally
- Preview server reads those same files
- Browser iframe loads the workspace preview subdomain
- The preview bootstraps a same-origin EIP-1193 bridge, posts wallet requests to the parent shell with exact origin checks, and the shell forwards approved RPC calls through control plane / gateway to the runner's Hardhat RPC

### 5. User hits a revert

Flow:
- Runner Hardhat process returns a revert
- Agent asks runner for the trace
- Agent queries 0G Storage for similar patterns
- On miss, control plane uses the AXL sidecar to ask peers
- A verified patch comes back, is tested inside the same workspace runner, and then committed to the workspace files

### 6. User deploys live

Flow:
- User clicks Ship
- Agent reads deployment state from the workspace
- Control plane calls KeeperHub for simulation + execution
- KeeperHub returns tx hashes and audit IDs
- Control plane writes those into workspace state and streams them to the UI

---

## Docker Strategy

### Core Principle

The **control plane is one container image**.
The **workspace runner is another container image**.

That is enough.

Do not split this into ten microservices. For the hackathon, that would be self-harm.

### Containers

#### `crucible-gateway`
Recommended: **Caddy** or **Traefik**

Responsibilities:
- HTTPS termination
- Route `crucible.yourdomain.com` → control plane
- Route `preview-<workspace-id>.crucible.yourdomain.com` → correct workspace runner
- Proxy websocket upgrades

#### `crucible-control-plane`
Recommended: Bun + Hono app

Responsibilities:
- Serves frontend shell
- Auth / session management
- SQLite metadata
- Agent orchestration
- MCP coordination
- Calls out to 0G, KeeperHub, AXL
- Starts/stops workspace runners

#### `crucible-axl`
Optional sidecar, but recommended

Responsibilities:
- Runs one AXL node binary for the deployment
- Keeps mesh lifecycle separate from the app process

#### `crucible-runner`
One container per active workspace

Responsibilities:
- Workspace filesystem mount
- Hardhat node
- Preview dev server
- PTY shell
- Compilation/deployment/tracing tools

---

## Docker on the Laptop

Your G14 is powerful enough for this, but you should enforce limits.

### Good default limits for a home-hosted beta

- Max active workspaces: **4–6**
- Idle timeout: **15 minutes**
- Max runner memory: **2–3 GB per workspace**
- Max runner CPU: **2 vCPU equivalent per workspace**
- Preview server auto-stop when tab is idle or workspace is archived

This keeps the laptop responsive and avoids a single tester eating the machine.

### Public exposure from home

The easiest safe-ish approach is:

- Docker Compose on Ubuntu
- Caddy as local reverse proxy
- **Cloudflare Tunnel** to expose the site publicly

This avoids:
- opening ports directly on your router
- managing residential IP changes
- dealing with raw TLS issuance on a home IP

---

## Docker on AWS Later

The same runtime lifts cleanly to AWS with minimal changes:

### Lowest-friction AWS path

- One EC2 instance
- Docker Compose
- EBS volume for persistent workspace storage
- Caddy for ingress
- Route53 + normal DNS

This is the cleanest migration from the laptop.

### If you need more scale later

- Control plane on ECS or EC2
- Runner containers scheduled separately
- EFS or attached volume strategy for workspace persistence
- External Postgres if concurrency grows

Do not start here. Start with **single EC2 + Compose**.

---

## Security Reality Check

If strangers can prompt the agent to generate code, run previews, and access a shell-like environment, you are effectively offering code execution as a service.

That means the minimum acceptable protections are:

- Workspace runners run as **non-root**
- No host filesystem mounts except the workspace volume
- Per-runner CPU and memory limits
- Idle cleanup and hard kill timeouts
- No raw Docker socket mounted into the runner
- Terminal access is authenticated and ideally scoped to the workspace owner
- The preview runs on a **different origin** from the main app, never same-origin with the control plane UI
- Control-plane auth cookies are **host-only** and not shared with preview subdomains
- The preview gets its wallet bridge from a **preview-origin bootstrap script**, not from the parent mutating the iframe DOM
- Parent/preview messaging uses exact origin checks, and `/ws/rpc` enforces origin validation, method allowlists, and per-workspace rate limits

For the MVP, the control plane can manage runner containers through Docker on the same host. That is acceptable for a hackathon beta. Just be honest that it is not hardened multi-tenant infrastructure.

---

## Practical Recommendation

If you want the simplest deployable architecture that still respects reality, do this:

1. **Build the app around a control plane + runner split now**.
2. **Run it via Docker Compose on your laptop first**.
3. **Expose it through Cloudflare Tunnel** for testing.
4. If judges or testers need a more stable host, **move the same stack to a single EC2 instance**.

That gives you:
- one architecture
- one set of images
- one deployment model
- minimal rework between laptop and AWS

---

## Suggested Compose-Level Services

```yaml
services:
  gateway:
    image: caddy:latest

  control-plane:
    image: crucible/control-plane:latest
    volumes:
      - crucible-data:/data
      - /var/run/docker.sock:/var/run/docker.sock

  axl:
    image: crucible/axl:latest
    volumes:
      - axl-data:/var/lib/axl

  cloudflared:
    image: cloudflare/cloudflared:latest
```

Workspace runners are started dynamically by the control plane rather than being pinned in `docker-compose.yml` ahead of time.

---

## What Changes in the Existing Spec

The current docs describe the **logical runtime** correctly, but for live deployment we should interpret them like this:

- `backend` becomes the **control plane container**
- `Hardhat + preview + PTY` move into the **workspace runner container**
- `AXL node` becomes a **deployment-level sidecar**
- `/workspace/{workspaceId}/` becomes a **persistent mounted volume path**

The user-facing UX does not change.

---

## Bottom Line

Yes, you can host this from your Ubuntu laptop.

The right way to do it is **not** one giant process with arbitrary code execution directly on the host. The right way is:

- one control plane container
- one AXL sidecar
- one runner container per workspace
- one persistent data volume
- one reverse proxy
- one Cloudflare Tunnel for the laptop

Then later, move the exact same containers to EC2 if needed.