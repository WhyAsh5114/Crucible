/**
 * Per-workspace registry of in-flight agent turn `AbortController`s.
 *
 * Single-process only — same caveat as `agent-bus.ts`. A multi-instance
 * backend would need to coordinate cancellation through Redis pub/sub or a
 * Postgres LISTEN/NOTIFY adapter, but right now both producers live in the
 * same Bun process so a `Map` is sufficient.
 */

const controllers = new Map<string, AbortController>();

/**
 * Register a fresh `AbortController` for `workspaceId`. If a controller is
 * already tracked for this workspace it is aborted first — back-to-back
 * prompts on the same workspace cancel the previous turn rather than racing.
 */
export function registerAgentTurn(workspaceId: string): AbortController {
  const existing = controllers.get(workspaceId);
  if (existing) existing.abort();
  const controller = new AbortController();
  controllers.set(workspaceId, controller);
  return controller;
}

/**
 * Remove the tracked controller for `workspaceId` without aborting. Called
 * by the inference router in a `finally` once the turn drains so a future
 * `cancelAgentTurn` does not abort an unrelated turn that runs after.
 */
export function clearAgentTurn(workspaceId: string, controller: AbortController): void {
  if (controllers.get(workspaceId) === controller) {
    controllers.delete(workspaceId);
  }
}

/**
 * Abort the active turn for `workspaceId` if one is registered. Returns
 * `true` when a controller was found and aborted, `false` otherwise.
 */
export function cancelAgentTurn(workspaceId: string): boolean {
  const controller = controllers.get(workspaceId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(workspaceId);
  return true;
}
