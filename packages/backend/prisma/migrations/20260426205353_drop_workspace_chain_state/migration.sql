-- AlterTable: drop the chainState column from Workspace.
-- Chain state is owned exclusively by WorkspaceRuntime.chainState.
ALTER TABLE "workspace" DROP COLUMN IF EXISTS "chainState";
