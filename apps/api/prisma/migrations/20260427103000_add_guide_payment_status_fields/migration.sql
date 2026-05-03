-- AlterTable
ALTER TABLE "Guide"
ADD COLUMN "paymentStatus" TEXT DEFAULT 'OPEN',
ADD COLUMN "paymentStatusSource" TEXT,
ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3),
ADD COLUMN "paymentConfirmedByUserId" TEXT,
ADD COLUMN "serproLastCheckedAt" TIMESTAMP(3),
ADD COLUMN "serproLastCheckResult" TEXT,
ADD COLUMN "serproLastSeenAt" TIMESTAMP(3),
ADD COLUMN "serproService" TEXT;

-- Backfill
UPDATE "Guide"
SET "paymentStatus" = 'OPEN'
WHERE "paymentStatus" IS NULL;

-- CreateIndex
CREATE INDEX "Guide_paymentStatus_vencimento_idx" ON "Guide"("paymentStatus", "vencimento");
