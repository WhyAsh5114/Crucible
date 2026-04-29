// Standalone utility: write the preview bridge script for an existing workspace
// without starting the backend. Uses buildBridgeScript() from preview-manager
// so the output is always identical to what the backend injects at runtime.
import { buildBridgeScript } from '../packages/backend/src/lib/preview-manager.ts';
import { writeFileSync, mkdirSync } from 'fs';

const script = buildBridgeScript();

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
