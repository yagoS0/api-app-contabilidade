CREATE TABLE "BaseSociosGerencial" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "autorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "competencia" TEXT NOT NULL, "fonte" TEXT NOT NULL,
  "prolaborePago" DECIMAL(18,2) NOT NULL,
  "distribuicaoPaga" DECIMAL(18,2) NOT NULL,
  "outrasRetiradas" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BaseSociosGerencial_companyId_competencia_id_idx" ON "BaseSociosGerencial"("companyId", "competencia", "id");
