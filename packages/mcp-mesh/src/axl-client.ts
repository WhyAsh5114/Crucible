/**
 * HTTP client for the AXL node's local API bridge.
 *
 * AXL exposes a plain HTTP interface on localhost so any language can use it.
 * We talk to it exclusively via three endpoints:
 *   GET  /topology  — own public key + IPv6 + spanning-tree peer list
 *   POST /send      — fire-and-forget message to a specific peer
 *   GET  /recv      — poll for the next queued incoming message
 */

export interface AXLTopologyPeer {
  public_key: string;
  ipv6?: string;
}

export interface AXLTopology {
  our_public_key: string;
  our_ipv6: string;
  peers: AXLTopologyPeer[];
}

export interface AXLRecvMessage {
  body: string;
  fromPeerId: string;
}

export class AXLClient {
  private readonly base: string;

  constructor(apiPort: number) {
    this.base = `http://127.0.0.1:${apiPort}`;
  }

  async topology(): Promise<AXLTopology> {
    const res = await fetch(`${this.base}/topology`);
    if (!res.ok) {
      throw new Error(`AXL /topology returned ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;

    // Build a normalised topology — the exact peer list shape varies across
    // AXL versions.  We accept any array field whose elements look like they
    // carry a public key.
    const peersCandidates: AXLTopologyPeer[] = [];
    for (const field of ['peers', 'known_peers', 'connected_peers', 'routing_table']) {
      const arr = raw[field];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (typeof entry === 'string' && entry.length === 64) {
          peersCandidates.push({ public_key: entry });
        } else if (
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Record<string, unknown>)['public_key'] === 'string'
        ) {
          peersCandidates.push(entry as AXLTopologyPeer);
        } else if (
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Record<string, unknown>)['key'] === 'string'
        ) {
          const e = entry as Record<string, unknown>;
          peersCandidates.push({ public_key: e['key'] as string, ipv6: e['ipv6'] as string });
        }
      }
      if (peersCandidates.length > 0) break;
    }

    return {
      our_public_key: String(raw['our_public_key'] ?? ''),
      our_ipv6: String(raw['our_ipv6'] ?? ''),
      peers: peersCandidates,
    };
  }

  async send(destinationPeerId: string, payload: string): Promise<void> {
    const res = await fetch(`${this.base}/send`, {
      method: 'POST',
      headers: {
        'X-Destination-Peer-Id': destinationPeerId,
        'Content-Type': 'text/plain',
      },
      body: payload,
    });
    // AXL returns 2xx on success; log but don't throw on 4xx so a bad peer
    // doesn't break the entire broadcast.
    if (!res.ok) {
      throw new Error(`AXL /send to ${destinationPeerId.slice(0, 8)}… returned ${res.status}`);
    }
  }

  /**
   * Poll for the next queued message. Returns null when the queue is empty
   * (204 No Content) or on any non-200 status.
   */
  async recv(): Promise<AXLRecvMessage | null> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/recv`);
    } catch {
      return null;
    }
    if (res.status === 204 || !res.ok) return null;
    const body = await res.text();
    const fromPeerId = res.headers.get('X-From-Peer-Id') ?? '';
    return { body, fromPeerId };
  }

  /** Returns true once /topology responds successfully. */
  async isReady(): Promise<boolean> {
    try {
      await this.topology();
      return true;
    } catch {
      return false;
    }
  }
}
