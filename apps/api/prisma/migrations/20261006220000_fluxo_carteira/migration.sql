CREATE TABLE "carteira_tarefas" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "competencia" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "dataInicio" DATE,
  "dataFim" DATE,
  "dados" JSONB NOT NULL DEFAULT '{}',
  "historico" JSONB NOT NULL DEFAULT '[]',
  "versao" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carteira_tarefas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "carteira_tarefas_portalClientId_competencia_chave_key" ON "carteira_tarefas"("portalClientId", "competencia", "chave");
CREATE INDEX "carteira_tarefas_competencia_idx" ON "carteira_tarefas"("competencia");
CREATE INDEX "carteira_tarefas_dataInicio_dataFim_idx" ON "carteira_tarefas"("dataInicio", "dataFim");
ALTER TABLE "carteira_tarefas" ADD CONSTRAINT "carteira_tarefas_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
