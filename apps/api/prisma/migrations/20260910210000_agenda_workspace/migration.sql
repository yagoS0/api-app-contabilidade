ALTER TABLE "obrigacoes" ADD COLUMN "agendaConfig" JSONB;
ALTER TABLE "ocorrencias_obrigacao" ADD COLUMN "agendaConfig" JSONB;
ALTER TABLE "regras_obrigacao" ADD COLUMN "agendaConfig" JSONB, ADD COLUMN "descricao" TEXT, ADD COLUMN "janelaTrabalho" JSONB;
CREATE TABLE "tarefas_agenda" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "titulo" TEXT NOT NULL, "descricao" TEXT, "config" JSONB NOT NULL, "estados" JSONB NOT NULL DEFAULT '{}', "excluidaEm" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "tarefas_agenda_pkey" PRIMARY KEY ("id"));
CREATE INDEX "tarefas_agenda_userId_excluidaEm_idx" ON "tarefas_agenda"("userId", "excluidaEm");
CREATE TABLE "agenda_ocultacoes" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "chave" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "agenda_ocultacoes_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "agenda_ocultacoes_userId_chave_key" ON "agenda_ocultacoes"("userId", "chave");
