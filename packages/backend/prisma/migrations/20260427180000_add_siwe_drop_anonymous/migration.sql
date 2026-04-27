-- DropForeignKey
ALTER TABLE "workspace" DROP CONSTRAINT "workspace_userId_fkey";

-- CreateTable
CREATE TABLE "walletAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "walletAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "walletAddress_userId_idx" ON "walletAddress"("userId");

-- CreateIndex
CREATE INDEX "walletAddress_address_idx" ON "walletAddress"("address");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "walletAddress" ADD CONSTRAINT "walletAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

