-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailLastError" TEXT,
ADD COLUMN     "emailNextRetryAt" TIMESTAMP(3),
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailStatus" TEXT;

-- CreateIndex
CREATE INDEX "Guide_emailStatus_emailNextRetryAt_idx" ON "Guide"("emailStatus", "emailNextRetryAt");
