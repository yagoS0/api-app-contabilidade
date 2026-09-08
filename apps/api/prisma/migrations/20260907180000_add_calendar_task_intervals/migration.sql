ALTER TABLE "obrigacoes"
  ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'OBRIGACAO',
  ADD COLUMN "descricao" TEXT,
  ADD COLUMN "dataInicio" DATE,
  ADD COLUMN "dataFim" DATE,
  ADD COLUMN "dataVencimento" DATE,
  ADD COLUMN "diasPreparacao" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ocorrencias_obrigacao"
  ADD COLUMN "dataInicio" DATE,
  ADD COLUMN "dataFim" DATE,
  ADD COLUMN "janelaPersonalizada" BOOLEAN NOT NULL DEFAULT false;

-- Sem preparação retroativa: o histórico continua um evento de um dia.
UPDATE "ocorrencias_obrigacao"
SET "dataInicio" = "dataVencimento", "dataFim" = "dataVencimento";

ALTER TABLE "obrigacoes"
  ADD CONSTRAINT "obrigacoes_tipo_check" CHECK ("tipo" IN ('OBRIGACAO', 'TAREFA')),
  ADD CONSTRAINT "obrigacoes_preparacao_check" CHECK ("diasPreparacao" BETWEEN 0 AND 365),
  ADD CONSTRAINT "obrigacoes_intervalo_check" CHECK ("dataInicio" IS NULL OR "dataFim" >= "dataInicio");
ALTER TABLE "ocorrencias_obrigacao"
  ADD CONSTRAINT "ocorrencias_intervalo_check" CHECK ("dataInicio" IS NULL OR "dataFim" >= "dataInicio");
CREATE INDEX "ocorrencias_obrigacao_dataInicio_dataFim_idx" ON "ocorrencias_obrigacao"("dataInicio", "dataFim");

ALTER TABLE "regras_obrigacao" ADD COLUMN "diasPreparacao" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "regras_obrigacao" ADD CONSTRAINT "regras_preparacao_check" CHECK ("diasPreparacao" BETWEEN 0 AND 365);
