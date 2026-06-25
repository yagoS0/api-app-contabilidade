-- Q30 Fase 1: trilha de auditoria de acesso aos certificados (LGPD). ADD-only: sem DROP, sem reset.
CREATE TABLE "cert_access_logs" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT,
    "certKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "consumer" TEXT,
    "actorUserId" TEXT,
    "workerName" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cert_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cert_access_logs_portalClientId_createdAt_idx" ON "cert_access_logs"("portalClientId", "createdAt");

-- CreateIndex
CREATE INDEX "cert_access_logs_certKind_createdAt_idx" ON "cert_access_logs"("certKind", "createdAt");
