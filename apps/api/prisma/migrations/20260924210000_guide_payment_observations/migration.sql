CREATE TABLE "GuidePaymentObservation" (
  "id" TEXT NOT NULL,
  "consultaId" TEXT NOT NULL,
  "guideId" TEXT,
  "guideReferenceId" TEXT NOT NULL,
  "portalClientId" TEXT,
  "documentRevision" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "applied" BOOLEAN NOT NULL,
  "ignoredReason" TEXT,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuidePaymentObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuidePaymentObservation_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GuidePaymentObservation_guideReferenceId_consultaId_key" ON "GuidePaymentObservation"("guideReferenceId", "consultaId");
CREATE INDEX "GuidePaymentObservation_guideReferenceId_checkedAt_idx" ON "GuidePaymentObservation"("guideReferenceId", "checkedAt");
CREATE INDEX "GuidePaymentObservation_portalClientId_checkedAt_idx" ON "GuidePaymentObservation"("portalClientId", "checkedAt");
