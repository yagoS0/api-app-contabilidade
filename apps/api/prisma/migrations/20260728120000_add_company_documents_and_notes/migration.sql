-- Documentos e anotações da empresa. Aditiva: duas tabelas novas, nada existente é tocado.
--
-- Documentos: contrato social, cartão CNPJ, inscrições — que até aqui não tinham onde morar.
-- O arquivo em si NÃO vem pro banco; `fileKey` referencia o mesmo storage das guias
-- (GuideStorageService: LOCAL/S3/R2), pra herdar a resolução de volume já corrigida.
--
-- Anotações: `fixada` é exclusiva por empresa, mas a exclusividade é garantida na aplicação
-- (transação em CompanyNotesService), não por constraint — um índice único parcial impediria
-- o caso legítimo de zero anotações fixadas e complicaria o "desafixa a anterior".

CREATE TABLE "company_documents" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "validade" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_documents_portalClientId_tipo_idx" ON "company_documents"("portalClientId", "tipo");

ALTER TABLE "company_documents"
    ADD CONSTRAINT "company_documents_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "company_notes" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "importancia" TEXT NOT NULL DEFAULT 'MEDIA',
    "fixada" BOOLEAN NOT NULL DEFAULT false,
    "autorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_notes_portalClientId_fixada_idx" ON "company_notes"("portalClientId", "fixada");

ALTER TABLE "company_notes"
    ADD CONSTRAINT "company_notes_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
