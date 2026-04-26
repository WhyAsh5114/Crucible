-- CreateEnum
CREATE TYPE "RuntimeStatus" AS ENUM ('ready', 'crashed', 'stopped', 'starting', 'degraded');

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directoryPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chainState" JSONB,
    "deployments" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_runtime" (
    "runtimeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "RuntimeStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "previewUrl" TEXT,
    "terminalSessionId" TEXT,
    "chainPort" INTEGER,
    "compilerPort" INTEGER,
    "deployerPort" INTEGER,
    "walletPort" INTEGER,
    "terminalPort" INTEGER,
    "chainState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_runtime_pkey" PRIMARY KEY ("runtimeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_directoryPath_key" ON "workspace"("directoryPath");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_runtime_workspaceId_key" ON "workspace_runtime"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_runtime_status_idx" ON "workspace_runtime"("status");

-- AddForeignKey
ALTER TABLE "workspace_runtime" ADD CONSTRAINT "workspace_runtime_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
