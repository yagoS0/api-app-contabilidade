-- CreateTable
CREATE TABLE "fiscal_execution_logs" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "guidesFound" INTEGER,
    "guidesCaptured" INTEGER,
    "guidesUpdated" INTEGER,
    "guidesChecked" INTEGER,
    "guidesPaid" INTEGER,
    "guidesOverdue" INTEGER,
    "guidesOpen" INTEGER,
    "circularUpdated" BOOLEAN,
    "entriesGenerated" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "skipReason" TEXT,
    "triggeredBy" TEXT,

    CONSTRAINT "fiscal_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_execution_logs_portalClientId_startedAt_idx" ON "fiscal_execution_logs"("portalClientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "fiscal_execution_logs_portalClientId_competencia_action_idx" ON "fiscal_execution_logs"("portalClientId", "competencia", "action");

-- AddForeignKey
ALTER TABLE "fiscal_execution_logs" ADD CONSTRAINT "fiscal_execution_logs_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
