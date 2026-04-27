-- AlterTable: add required userId FK to workspace
ALTER TABLE "workspace" ADD COLUMN "userId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "workspace_userId_idx" ON "workspace"("userId");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
