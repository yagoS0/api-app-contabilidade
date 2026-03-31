-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "portalClientId" TEXT,
    "guideId" TEXT,
    "contentHash" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "parserSource" TEXT,
    "documentType" TEXT,
    "payload" JSONB,
    "confidence" DOUBLE PRECISION,
    "warnings" JSONB,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_processing_logs" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_contentHash_idx" ON "documents"("contentHash");

-- CreateIndex
CREATE INDEX "documents_guideId_idx" ON "documents"("guideId");

-- CreateIndex
CREATE INDEX "documents_requestId_idx" ON "documents"("requestId");

-- CreateIndex
CREATE INDEX "documents_portalClientId_idx" ON "documents"("portalClientId");

-- CreateIndex
CREATE INDEX "document_extractions_documentId_idx" ON "document_extractions"("documentId");

-- CreateIndex
CREATE INDEX "document_processing_logs_documentId_idx" ON "document_processing_logs"("documentId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_processing_logs" ADD CONSTRAINT "document_processing_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
