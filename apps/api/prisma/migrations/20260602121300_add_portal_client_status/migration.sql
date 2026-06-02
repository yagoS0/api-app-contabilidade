-- Q11.1: status (ATIVA/SUSPENSA) em PortalClient. Suspender é reversível;
-- excluir é hard-delete via DELETE /companies/:id (cascade Prisma).

-- AlterTable
ALTER TABLE "PortalClient" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ATIVA',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateIndex
CREATE INDEX "PortalClient_status_idx" ON "PortalClient"("status");
