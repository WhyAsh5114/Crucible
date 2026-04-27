-- AlterTable
ALTER TABLE "workspace" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "workspace_userId_idx" ON "workspace"("userId");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
