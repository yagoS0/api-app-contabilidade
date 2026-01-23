-- Add NFSe-related fields to Company
ALTER TABLE "Company"
ADD COLUMN "inscricaoMunicipal" TEXT,
ADD COLUMN "codigoServicoNacional" TEXT,
ADD COLUMN "codigoServicoMunicipal" TEXT,
ADD COLUMN "rpsSerie" TEXT,
ADD COLUMN "rpsNumero" TEXT,
ADD COLUMN "optanteSimples" BOOLEAN DEFAULT FALSE,
ADD COLUMN "regimeEspecialTributacao" TEXT;

-- Create ServiceInvoice table for NFS-e
CREATE TABLE "ServiceInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT,
    "tomadorDoc" TEXT NOT NULL,
    "tomadorNome" TEXT NOT NULL,
    "valorServicos" DECIMAL(18,2) NOT NULL,
    "aliquota" DECIMAL(6,3),
    "issRetido" BOOLEAN NOT NULL DEFAULT FALSE,
    "competencia" TIMESTAMP(3),
    "numeroNfse" TEXT,
    "codigoVerificacao" TEXT,
    "rpsNumero" TEXT,
    "rpsSerie" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "xml" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceInvoice_pkey" PRIMARY KEY ("id")
);

-- Relations
ALTER TABLE "ServiceInvoice"
ADD CONSTRAINT "ServiceInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceInvoice"
ADD CONSTRAINT "ServiceInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ServiceInvoice_companyId_idx" ON "ServiceInvoice"("companyId");
CREATE INDEX "ServiceInvoice_clientId_idx" ON "ServiceInvoice"("clientId");
CREATE INDEX "ServiceInvoice_numeroNfse_idx" ON "ServiceInvoice"("numeroNfse");
