-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT,
    "chave" TEXT NOT NULL,
    "numero" TEXT,
    "serie" TEXT,
    "dhEmi" TIMESTAMP(3),
    "emitCnpj" TEXT,
    "emitNome" TEXT,
    "destDoc" TEXT,
    "destNome" TEXT,
    "cfopPrincipal" TEXT,
    "valorTotal" DECIMAL(18,2),
    "valorProdutos" DECIMAL(18,2),
    "valorServicos" DECIMAL(18,2),
    "valorImpostos" DECIMAL(18,2),
    "valorIcms" DECIMAL(18,2),
    "valorPis" DECIMAL(18,2),
    "valorCofins" DECIMAL(18,2),
    "valorIss" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'imported',
    "fileKey" TEXT,
    "fileUrl" TEXT,
    "fileType" TEXT NOT NULL DEFAULT 'xml',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "codigo" TEXT,
    "descricao" TEXT,
    "ncm" TEXT,
    "cfop" TEXT,
    "unidade" TEXT,
    "quantidade" DECIMAL(14,4),
    "valorUnitario" DECIMAL(18,4),
    "valorTotal" DECIMAL(18,2),
    "cstIcms" TEXT,
    "csosn" TEXT,
    "cstPis" TEXT,
    "cstCofins" TEXT,
    "aliquotaIcms" DECIMAL(6,3),
    "aliquotaPis" DECIMAL(6,3),
    "aliquotaCofins" DECIMAL(6,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_companyId_idx" ON "Invoice"("companyId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_chave_key" ON "Invoice"("companyId", "chave");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
