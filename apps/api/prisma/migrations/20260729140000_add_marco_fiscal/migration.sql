-- Datas marcadas à mão no calendário fiscal. Aditiva: uma tabela nova, nada existente é tocado.
--
-- O calendário mostra sozinho o que JÁ está no banco (guias com vencimento, competência não
-- transmitida, mês não fechado). Esta tabela é para o que não vem de dado nenhum — a virada do
-- IBS/CBS sendo o caso concreto.
--
-- `portalClientId` NULO = marco do escritório, vale para todas as empresas. Por isso a FK é
-- opcional e o índice de data existe sozinho: a consulta mais comum é "o que há neste mês",
-- atravessando todas as empresas.

CREATE TABLE "marcos_fiscais" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT,
    "titulo" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT,
    "importancia" TEXT NOT NULL DEFAULT 'MEDIA',
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marcos_fiscais_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marcos_fiscais_data_idx" ON "marcos_fiscais"("data");
CREATE INDEX "marcos_fiscais_portalClientId_data_idx" ON "marcos_fiscais"("portalClientId", "data");

ALTER TABLE "marcos_fiscais"
    ADD CONSTRAINT "marcos_fiscais_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
