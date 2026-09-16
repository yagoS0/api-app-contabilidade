CREATE TABLE "LaboratorioCenario" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "autorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "companyId" TEXT REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "nome" TEXT NOT NULL, "periodo" TEXT NOT NULL, "versao" TEXT NOT NULL,
  "entradasJson" JSONB NOT NULL, "resultadoJson" JSONB NOT NULL, "origemJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LaboratorioCenario_autorId_createdAt_idx" ON "LaboratorioCenario"("autorId", "createdAt");
CREATE TABLE "ClassificacaoGerencial" (
  "companyId" TEXT NOT NULL PRIMARY KEY REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "contasJson" JSONB NOT NULL, "revisao" INTEGER NOT NULL DEFAULT 1,
  "atualizadoPor" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
