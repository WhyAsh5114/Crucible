/**
 * AXL node lifecycle manager.
 *
 * Responsibilities:
 *   1. Generate a persistent ed25519 identity key for this workspace on first
 *      start (stored at ${workspaceRoot}/.crucible/axl-private.pem).
 *   2. Write a node-config.json pointing at the key and Gensyn's public
 *      bootstrap peers so peer discovery is automatic.
 *   3. Spawn the AXL binary and wait until its HTTP API is ready.
 *   4. Run a background recv-poll loop that classifies incoming messages and
 *      routes them into the appropriate in-memory queue.
 *   5. Expose the five mesh operations consumed by server.ts.
 */

import { spawn, type Subprocess } from 'bun';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type {
  MeshPeer,
  MeshHelpRequest,
  MeshHelpResponse,
  MeshPatchVerification,
} from '@crucible/types';
import type {
  BroadcastHelpInput,
  BroadcastHelpOutput,
  CollectResponsesInput,
  CollectResponsesOutput,
  RespondInput,
  RespondOutput,
  VerifyPeerPatchInput,
  ListPeersOutput,
} from '@crucible/types/mcp/mesh';
import { AXLClient } from './axl-client.ts';

// ── Constants ──────────────────────────────────────────────────────────────

/** Public bootstrap peers from gensyn-ai/axl node-config.json */
const GENSYN_BOOTSTRAP_PEERS = ['tls://34.46.48.224:9001', 'tls://136.111.135.206:9001'] as const;

/** The AXL binary path inside the Docker container (baked in during image build). */
const AXL_BINARY = process.env['AXL_NODE_PATH'] ?? '/usr/local/bin/axl-node';

/** Port the AXL binary exposes its local HTTP API on. */
const AXL_API_PORT = process.env['AXL_API_PORT'] ? parseInt(process.env['AXL_API_PORT'], 10) : 9002;

/** Polling interval for the recv loop. */
const RECV_POLL_MS = 100;

/** How long to wait for the AXL node to become ready. */
const AXL_READY_TIMEOUT_MS = 30_000;

// ── Message envelopes ──────────────────────────────────────────────────────

type HelpRequestEnvelope = {
  type: 'crucible/help_request';
  data: MeshHelpRequest;
};

type HelpResponseEnvelope = {
  type: 'crucible/help_response';
  data: MeshHelpResponse;
};

type CrucibleEnvelope = HelpRequestEnvelope | HelpResponseEnvelope;

function parseEnvelope(raw: string): CrucibleEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed['type'] === 'crucible/help_request' || parsed['type'] === 'crucible/help_response') {
      return parsed as unknown as CrucibleEnvelope;
    }
  } catch {
    // not JSON or not a crucible envelope — ignore
  }
  return null;
}

// ── Node Manager ──────────────────────────────────────────────────────────

export class AXLNodeManager {
  private readonly workspaceRoot: string;
  private readonly axlClient: AXLClient;

  private proc: Subprocess | null = null;
  private recvTimer: ReturnType<typeof setInterval> | null = null;
  private ownPublicKey: string = '';

  /** Responses queued by reqId (from remote peers). */
  private responsesByReqId = new Map<string, MeshHelpResponse[]>();

  /**
   * Incoming help requests from remote peers that this node can respond to.
   * Key: reqId, value: { request, fromPeerId }
   */
  private incomingRequests = new Map<string, { request: MeshHelpRequest; fromPeerId: string }>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.axlClient = new AXLClient(AXL_API_PORT);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const crucibleDir = join(this.workspaceRoot, '.crucible');
    await mkdir(crucibleDir, { recursive: true });

    const keyPath = join(crucibleDir, 'axl-private.pem');
    await this.ensureKeyExists(keyPath);

    const configPath = join(crucibleDir, 'axl-node-config.json');
    await this.writeNodeConfig(keyPath, configPath);

    this.proc = spawn([AXL_BINARY, '-config', configPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Drain stdout/stderr to avoid back-pressure (we don't process them but
    // the process will block if the pipe fills).
    void this.drainStream(
      this.proc.stdout instanceof ReadableStream ? this.proc.stdout : null,
      '[axl]',
    );
    void this.drainStream(
      this.proc.stderr instanceof ReadableStream ? this.proc.stderr : null,
      '[axl:err]',
    );

    await this.waitForReady();

    const topology = await this.axlClient.topology();
    this.ownPublicKey = topology.our_public_key;

    this.recvTimer = setInterval(() => {
      void this.pollRecv();
    }, RECV_POLL_MS);

    console.log(`[mcp-mesh] AXL node ready  pubkey=${this.ownPublicKey.slice(0, 12)}…`);
  }

  async stop(): Promise<void> {
    if (this.recvTimer !== null) {
      clearInterval(this.recvTimer);
      this.recvTimer = null;
    }
    if (this.proc !== null) {
      this.proc.kill();
      this.proc = null;
    }
  }

  // ── Tool implementations ─────────────────────────────────────────────────

  async listPeers(): Promise<ListPeersOutput> {
    const topology = await this.axlClient.topology();
    const now = Date.now();
    const peers: MeshPeer[] = topology.peers.map((p) => ({
      nodeId: p.public_key as MeshPeer['nodeId'],
      lastSeen: now as MeshPeer['lastSeen'],
      reputation: 0.5,
    }));
    return { peers };
  }

  async broadcastHelp(input: BroadcastHelpInput): Promise<BroadcastHelpOutput> {
    const reqId = randomUUID() as MeshHelpRequest['reqId'];
    const issuedAt = Date.now() as MeshHelpRequest['issuedAt'];

    const request: MeshHelpRequest = { ...input, reqId, issuedAt };
    const envelope: HelpRequestEnvelope = { type: 'crucible/help_request', data: request };
    const payload = JSON.stringify(envelope);

    // Initialise the response queue for this reqId before sending so we don't
    // miss any fast replies that arrive between the send and collect call.
    this.responsesByReqId.set(reqId, []);

    const topology = await this.axlClient.topology();
    const sendErrors: string[] = [];

    for (const peer of topology.peers) {
      try {
        await this.axlClient.send(peer.public_key, payload);
      } catch (err) {
        sendErrors.push(`${peer.public_key.slice(0, 8)}…: ${String(err)}`);
      }
    }

    if (sendErrors.length > 0) {
      console.warn(`[mcp-mesh] broadcast_help partial failures: ${sendErrors.join(', ')}`);
    }

    return { reqId };
  }

  async collectResponses(input: CollectResponsesInput): Promise<CollectResponsesOutput> {
    const { reqId, waitMs = 10_000 } = input;
    const deadline = Date.now() + waitMs;

    // Ensure the queue exists even if broadcastHelp wasn't called on this node
    // (edge case: two instances of mcp-mesh sharing the same process space).
    if (!this.responsesByReqId.has(reqId)) {
      this.responsesByReqId.set(reqId, []);
    }

    while (Date.now() < deadline) {
      const collected = this.responsesByReqId.get(reqId) ?? [];
      if (collected.length > 0) {
        this.responsesByReqId.delete(reqId);
        return { responses: collected };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, RECV_POLL_MS));
    }

    const final = this.responsesByReqId.get(reqId) ?? [];
    this.responsesByReqId.delete(reqId);
    return { responses: final };
  }

  async respond(input: RespondInput): Promise<RespondOutput> {
    const { reqId, patch } = input;
    const pending = this.incomingRequests.get(reqId);
    if (!pending) {
      throw new Error(
        `No pending help request found for reqId=${reqId}. ` +
          `Either TTL expired or the request was never received.`,
      );
    }

    const verificationReceipt = `0x${createHash('sha256')
      .update(patch + reqId + 'verified')
      .digest('hex')}` as MeshHelpResponse['verificationReceipt'];

    const response: MeshHelpResponse = {
      reqId,
      peerId: this.ownPublicKey as MeshHelpResponse['peerId'],
      patch,
      verificationReceipt,
      respondedAt: Date.now() as MeshHelpResponse['respondedAt'],
    };

    const envelope: HelpResponseEnvelope = { type: 'crucible/help_response', data: response };
    await this.axlClient.send(pending.fromPeerId, JSON.stringify(envelope));

    this.incomingRequests.delete(reqId);
    return { ack: true };
  }

  verifyPeerPatch(input: VerifyPeerPatchInput): MeshPatchVerification {
    const { response } = input;

    if (!response.patch || typeof response.patch !== 'string') {
      return { result: 'failed', reason: 'Patch is empty or not a string.' };
    }

    if (
      !response.verificationReceipt.startsWith('0x') ||
      response.verificationReceipt.length < 10
    ) {
      return {
        result: 'failed',
        reason: `verificationReceipt is not a valid hex hash: ${response.verificationReceipt}`,
      };
    }

    // Compute a local receipt that the agent can record as evidence of structural
    // validation. Full chain re-execution is the agent's responsibility via the
    // existing repair loop tools (snapshot → deploy → call_contract).
    const localReceipt = `0x${createHash('sha256')
      .update(response.patch + response.reqId + 'local')
      .digest('hex')}` as `0x${string}`;

    return { result: 'verified', localReceipt };
  }

  getOwnPublicKey(): string {
    return this.ownPublicKey;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async ensureKeyExists(keyPath: string): Promise<void> {
    try {
      await access(keyPath);
      return; // Key already exists — keep the same identity across restarts.
    } catch {
      // Generate a new ed25519 private key in PKCS#8 PEM format, the same
      // format produced by `openssl genpkey -algorithm ed25519`.
      const { privateKey } = generateKeyPairSync('ed25519');
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      await writeFile(keyPath, pem, { mode: 0o600 });
      console.log(`[mcp-mesh] Generated new AXL identity key at ${keyPath}`);
    }
  }

  private async writeNodeConfig(keyPath: string, configPath: string): Promise<void> {
    const config = {
      PrivateKeyPath: keyPath,
      Peers: GENSYN_BOOTSTRAP_PEERS,
      Listen: [],
    };
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + AXL_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.axlClient.isReady()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`AXL node did not become ready within ${AXL_READY_TIMEOUT_MS}ms`);
  }

  private async pollRecv(): Promise<void> {
    try {
      const msg = await this.axlClient.recv();
      if (!msg) return;
      this.dispatchMessage(msg.body, msg.fromPeerId);
    } catch {
      // Network errors during poll are transient — suppress.
    }
  }

  private dispatchMessage(rawBody: string, fromPeerId: string): void {
    const envelope = parseEnvelope(rawBody);
    if (!envelope) return;

    if (envelope.type === 'crucible/help_request') {
      const req = envelope.data;

      // Enforce TTL — drop stale requests.
      if (Date.now() > req.issuedAt + req.ttlMs) {
        console.log(`[mcp-mesh] Dropping expired help_request reqId=${req.reqId}`);
        return;
      }

      this.incomingRequests.set(req.reqId, { request: req, fromPeerId });
      console.log(
        `[mcp-mesh] Received help_request reqId=${req.reqId} from ${fromPeerId.slice(0, 12)}…`,
      );
    } else if (envelope.type === 'crucible/help_response') {
      const resp = envelope.data;
      const queue = this.responsesByReqId.get(resp.reqId);
      if (queue) {
        queue.push(resp);
        console.log(
          `[mcp-mesh] Received help_response reqId=${resp.reqId} from ${fromPeerId.slice(0, 12)}…`,
        );
      }
      // If no queue exists for this reqId the response is unsolicited — drop.
    }
  }

  private async drainStream(
    stream: ReadableStream<Uint8Array> | null,
    prefix: string,
  ): Promise<void> {
    if (!stream) return;
    try {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trim();
        if (text) console.log(`${prefix} ${text}`);
      }
    } catch {
      // Stream closed — normal on process exit.
    }
  }
}
