ALTER TABLE "chamadas_ia" ADD COLUMN "custoEstimadoMicrousd" INTEGER, ADD COLUMN "tabelaPreco" TEXT;
UPDATE "chamadas_ia" SET "custoEstimadoMicrousd" = "custoEstimadoCentavos" * 10000, "tabelaPreco" = 'legado_arredondado' WHERE "custoEstimadoCentavos" BETWEEN 0 AND 214748;
ALTER TABLE "EventoPushAtendimento" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'MENSAGEM';
CREATE TABLE "encaminhamentos_suporte" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversaId" TEXT NOT NULL REFERENCES "conversas_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "mensagemId" TEXT NOT NULL UNIQUE,
  "estado" TEXT NOT NULL DEFAULT 'AGUARDANDO',
  "motivo" TEXT NOT NULL,
  "resumo" TEXT NOT NULL,
  "responsavelId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvidoEm" TIMESTAMP(3),
  CONSTRAINT "encaminhamento_estado" CHECK ("estado" IN ('AGUARDANDO','EM_ATENDIMENTO','RESOLVIDO'))
);
CREATE UNIQUE INDEX "encaminhamento_ativo_conversa" ON "encaminhamentos_suporte"("conversaId") WHERE "estado" <> 'RESOLVIDO';
CREATE INDEX "encaminhamento_estado_data" ON "encaminhamentos_suporte"("estado","createdAt");
