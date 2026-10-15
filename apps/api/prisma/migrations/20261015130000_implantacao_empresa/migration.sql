CREATE TABLE "implantacao_tarefas" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "descricao" TEXT,
  "destino" TEXT,
  "status" TEXT NOT NULL DEFAULT 'A_FAZER',
  "responsavel" TEXT,
  "prazo" DATE,
  "pendencia" TEXT,
  "origem" JSONB,
  "historico" JSONB NOT NULL DEFAULT '[]',
  "concluidaEm" TIMESTAMP(3),
  "concluidaPorId" TEXT,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "implantacao_tarefas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "implantacao_tarefas_status_check" CHECK ("status" IN ('A_FAZER','AGUARDANDO_CLIENTE','AGENDADO','CONCLUIDO','NAO_SE_APLICA')),
  CONSTRAINT "implantacao_tarefas_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "implantacao_tarefas_portalClientId_chave_key" ON "implantacao_tarefas"("portalClientId", "chave");
CREATE INDEX "implantacao_tarefas_status_prazo_idx" ON "implantacao_tarefas"("status", "prazo");
