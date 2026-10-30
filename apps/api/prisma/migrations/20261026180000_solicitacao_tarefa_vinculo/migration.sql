-- Additive only: no adoption, ownership inference or backfill.
ALTER TABLE "tarefas_calendario" ADD COLUMN "responsavelId" TEXT;
CREATE INDEX "tarefas_calendario_responsavelId_excluidaEm_idx" ON "tarefas_calendario"("responsavelId", "excluidaEm");
CREATE TABLE "solicitacoes_tarefas" (
  "solicitacaoId" TEXT NOT NULL,
  "tarefaId" TEXT NOT NULL,
  "empresaOrigemId" TEXT,
  "criadoPorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solicitacoes_tarefas_pkey" PRIMARY KEY ("solicitacaoId"),
  CONSTRAINT "solicitacoes_tarefas_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "encaminhamentos_suporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "solicitacoes_tarefas_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "tarefas_calendario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "solicitacoes_tarefas_tarefaId_key" ON "solicitacoes_tarefas"("tarefaId");
