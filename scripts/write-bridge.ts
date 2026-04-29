import {
  PREVIEW_BRIDGE_PROTOCOL,
  PREVIEW_BRIDGE_VERSION,
  ALLOWED_RPC_METHODS,
} from '../packages/types/src/preview.ts';
import { writeFileSync, mkdirSync } from 'fs';

const allowedJson = JSON.stringify(ALLOWED_RPC_METHODS);
const script = `// preview-bridge.js — injected by Crucible
(function () {
  var PROTOCOL = ${JSON.stringify(PREVIEW_BRIDGE_PROTOCOL)};
  var VERSION = ${PREVIEW_BRIDGE_VERSION};
  var ALLOWED = new Set(${allowedJson});
  var nextId = 1;
  var pending = new Map();
  var listeners = new Map();
  function genId() { return String(nextId++); }
  function sendToShell(msg) { window.parent.postMessage(msg, '*'); }
  function emitEvent(name, payload) {
    var cbs = listeners.get(name);
    if (cbs) cbs.forEach(function(cb) { cb(payload); });
  }
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.protocol !== PROTOCOL || d.version !== VERSION) return;
    if (d.direction !== 'shell-to-preview') return;
    if (d.type === 'hello_ack') {
      emitEvent('connect', { chainId: d.chainId });
      emitEvent('chainChanged', d.chainId);
    } else if (d.type === 'rpc_response') {
      var p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.outcome.ok) {
        p.resolve(d.outcome.result);
      } else {
        var err = new Error(d.outcome.message);
        err.code = d.outcome.code;
        p.reject(err);
      }
    } else if (d.type === 'event') {
      emitEvent(d.event, d.payload);
    }
  });
  window.ethereum = {
    isMetaMask: false,
    isCrucible: true,
    request: function(req) {
      var method = req.method;
      var params = req.params || [];
      if (!ALLOWED.has(method)) {
        var e2 = new Error('Method ' + method + ' not supported by Crucible bridge');
        e2.code = 4200;
        return Promise.reject(e2);
      }
      return new Promise(function(resolve, reject) {
        var id = genId();
        pending.set(id, { resolve: resolve, reject: reject });
        sendToShell({
          protocol: PROTOCOL,
          version: VERSION,
          id: id,
          direction: 'preview-to-shell',
          type: 'rpc_request',
          method: method,
          params: params,
        });
      });
    },
    on: function(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
    },
    removeListener: function(event, cb) {
      var cbs = listeners.get(event);
      if (cbs) cbs.delete(cb);
    },
  };
  // Announce via EIP-6963 so wagmi/viem discover us as "Crucible" instead
  // of falling back to the MetaMask extension (if installed).
  var providerDetail = {
    info: {
      uuid: 'crucible-preview-bridge-v1',
      name: 'Crucible',
      icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text y=%2224%22 font-size=%2224%22>\u2697</text></svg>',
      rdns: 'app.crucible.preview',
    },
    provider: window.ethereum,
  };
  function announceProvider() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(providerDetail) }));
  }
  window.addEventListener('eip6963:requestProvider', announceProvider);
  announceProvider();
  function sendHello() {
    sendToShell({
      protocol: PROTOCOL,
      version: VERSION,
      id: genId(),
      direction: 'preview-to-shell',
      type: 'hello',
      origin: window.location.origin,
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendHello);
  } else {
    sendHello();
  }
})();
`;

const WS_ID = process.argv[2];
if (!WS_ID) {
  console.error('Usage: bun scripts/write-bridge.ts <workspaceId>');
  process.exit(1);
}
const WORKSPACES_ROOT =
  process.env['CRUCIBLE_WORKSPACES_ROOT'] ?? '/Users/anonjr/Documents/Web/Crucible/.workspaces';
const dir = `${WORKSPACES_ROOT}/${WS_ID}/frontend/public/__crucible`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/preview-bridge.js`, script);
console.log(`Written to ${dir}/preview-bridge.js`);
console.log(`Allowed methods: ${ALLOWED_RPC_METHODS.length}`);
