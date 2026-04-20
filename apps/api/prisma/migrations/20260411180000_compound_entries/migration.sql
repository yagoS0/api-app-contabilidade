-- CreateTable accounting_entry_lines
CREATE TABLE "accounting_entry_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "accounting_entry_lines_pkey" PRIMARY KEY ("id")
);

-- Migrar dados existentes: cada entry vira 2 linhas
INSERT INTO "accounting_entry_lines" ("id", "entryId", "conta", "tipo", "valor", "ordem")
SELECT gen_random_uuid(), "id", "contaDebito", 'D', "valor", 0
FROM "accounting_entries"
WHERE "contaDebito" IS NOT NULL AND "contaDebito" != '';

INSERT INTO "accounting_entry_lines" ("id", "entryId", "conta", "tipo", "valor", "ordem")
SELECT gen_random_uuid(), "id", "contaCredito", 'C', "valor", 1
FROM "accounting_entries"
WHERE "contaCredito" IS NOT NULL AND "contaCredito" != '';

-- Adicionar novas colunas em accounting_entries
ALTER TABLE "accounting_entries" ADD COLUMN "statusPagamento" TEXT NOT NULL DEFAULT 'NA';
ALTER TABLE "accounting_entries" ADD COLUMN "openEntryId" TEXT;
ALTER TABLE "accounting_entries" ADD COLUMN "subtipo" TEXT;

-- Remover colunas antigas
ALTER TABLE "accounting_entries" DROP COLUMN "contaDebito";
ALTER TABLE "accounting_entries" DROP COLUMN "contaCredito";
ALTER TABLE "accounting_entries" DROP COLUMN "valor";

-- Indexes
CREATE INDEX "accounting_entry_lines_entryId_idx" ON "accounting_entry_lines"("entryId");
CREATE INDEX "accounting_entries_portalClientId_statusPagamento_idx" ON "accounting_entries"("portalClientId", "statusPagamento");
CREATE INDEX "accounting_entries_portalClientId_subtipo_idx" ON "accounting_entries"("portalClientId", "subtipo");

-- Foreign keys
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_openEntryId_fkey"
    FOREIGN KEY ("openEntryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
