-- Preserve all S1 evidence and its append-only triggers. No historical rows are rewritten.
BEGIN;
ALTER TABLE encaminhamentos_suporte ADD COLUMN "origemDados" JSONB;
ALTER TABLE solicitacoes_eventos ALTER COLUMN "atorId" DROP NOT NULL,
  ADD COLUMN "sistemaId" TEXT,
  ADD CONSTRAINT solicitacoes_eventos_autoria CHECK (("atorId" IS NOT NULL) <> ("sistemaId" IS NOT NULL));
ALTER TABLE solicitacoes_comandos ALTER COLUMN "atorId" DROP NOT NULL,
  ADD COLUMN "sistemaId" TEXT,
  ADD CONSTRAINT solicitacoes_comandos_autoria CHECK (("atorId" IS NOT NULL) <> ("sistemaId" IS NOT NULL));
ALTER TABLE solicitacoes_mensagens ALTER COLUMN "atorId" DROP NOT NULL,
  ADD COLUMN "sistemaId" TEXT,
  ADD CONSTRAINT solicitacoes_mensagens_autoria CHECK (("atorId" IS NOT NULL) <> ("sistemaId" IS NOT NULL));
CREATE UNIQUE INDEX "solicitacoes_comandos_sistemaId_chave_key" ON solicitacoes_comandos ("sistemaId", chave);
ALTER TABLE solicitacoes_mensagens DROP CONSTRAINT solicitacoes_mensagens_pkey,
  ADD CONSTRAINT solicitacoes_mensagens_pkey PRIMARY KEY ("solicitacaoId", "mensagemId");
COMMIT;
