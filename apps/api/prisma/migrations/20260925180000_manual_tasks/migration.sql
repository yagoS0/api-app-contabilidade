CREATE TABLE "ManualTask" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "activeKey" TEXT,
  "kind" TEXT NOT NULL,
  "companyIds" JSONB NOT NULL,
  "description" TEXT,
  "competencia" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running',
  "total" INTEGER NOT NULL DEFAULT 0,
  "completed" INTEGER NOT NULL DEFAULT 0,
  "progress" JSONB,
  "result" JSONB,
  "responseStatus" INTEGER,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ManualTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManualTask_ownerId_requestKey_key" ON "ManualTask"("ownerId", "requestKey");
CREATE UNIQUE INDEX "ManualTask_activeKey_key" ON "ManualTask"("activeKey");
CREATE INDEX "ManualTask_ownerId_createdAt_idx" ON "ManualTask"("ownerId", "createdAt");
CREATE INDEX "ManualTask_status_updatedAt_idx" ON "ManualTask"("status", "updatedAt");
