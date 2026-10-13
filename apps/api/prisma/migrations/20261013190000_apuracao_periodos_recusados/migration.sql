-- Memória de recusas explícitas, separada do histórico de períodos aceitos.
CREATE TABLE "apuracao_periodos_recusados" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "competencia" TEXT NOT NULL,
  "insumosHash" TEXT NOT NULL,
  "lista" TEXT NOT NULL,
  "pa" TEXT NOT NULL,
  "fonte" TEXT NOT NULL DEFAULT 'RESPOSTA_SIMULACAO',
  "serproChamadaId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "apuracao_periodos_recusados_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "apuracao_periodos_recusados_lista_check" CHECK ("lista" IN ('receitas', 'folhas')),
  CONSTRAINT "apuracao_periodos_recusados_comp_check" CHECK ("competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "apuracao_periodos_recusados_pa_check" CHECK ("pa" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "apuracao_periodos_recusados_hash_check" CHECK ("insumosHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "apuracao_periodos_recusados_contexto_key"
  ON "apuracao_periodos_recusados" ("portalClientId", "competencia", "insumosHash", "lista", "pa");
