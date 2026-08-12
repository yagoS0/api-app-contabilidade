-- RELATÓRIO "Faturamento no Período — Consolidado", salvo por (empresa, competência).
--
-- ⚠ ADITIVA. Uma tabela nova. Nenhuma tabela existente é alterada, nenhuma coluna é dropada,
-- nenhum dado é tocado. `portal_clients` NÃO ganha coluna: a FK mora aqui.
--
-- ⚠ POR QUE UMA TABELA NOVA E NÃO UMA COLUNA EM `apuracao_snapshots`.
-- As competências ZERADAS não têm snapshot — foram medidas 190 células empresa×competência com
-- faturamento EMIT = 0 e ZERO `ApuracaoSnapshot`. Criar um snapshot só para guardar a marca do
-- relatório exigiria preencher `rbt12` e `receitaPorTipo` (NOT NULL): dado fiscal FABRICADO dentro
-- de um registro auditável. E a empresa sem faturamento é justamente uma das que mais precisam do
-- relatório — é ele que mostra que o mês não teve nota.
--
-- ⚠ O RELATÓRIO INTEIRO VAI EM `dados` (JSONB), de propósito. Ele é um DOCUMENTO (blocos por tipo
-- de operação, linhas nota a nota, totais, quadro-resumo e o pré-apurado), não um conjunto de
-- métricas. Espalhá-lo em colunas obrigaria a migrar o banco a cada coluna nova do impresso — e
-- as colunas que hoje NÃO temos (IPI, ST, Outros, Líquido) viajam como `null` dentro do Json,
-- justamente para não existirem como coluna NOT NULL DEFAULT 0 em lugar nenhum.

CREATE TABLE "relatorios_faturamento" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  -- YYYY-MM, o mesmo formato de `apuracao_snapshots.competencia`.
  "competencia"    TEXT NOT NULL,

  "dados" JSONB NOT NULL,

  "geradoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- `users.id` de quem mandou gerar. Nulo para geração fora de uma sessão.
  "geradoPor" TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "relatorios_faturamento_pkey" PRIMARY KEY ("id")
);

-- Um relatório por empresa e competência: regerar SOBRESCREVE. Guardar histórico de versões
-- pareceria mais seguro e seria pior — duas fotos do mesmo mês, sem nada que diga qual delas o
-- contador estava olhando quando decidiu. `geradoEm` responde "de quando é esta".
CREATE UNIQUE INDEX "relatorios_faturamento_portalClientId_competencia_key"
  ON "relatorios_faturamento"("portalClientId", "competencia");

CREATE INDEX "relatorios_faturamento_portalClientId_competencia_idx"
  ON "relatorios_faturamento"("portalClientId", "competencia");

ALTER TABLE "relatorios_faturamento"
  ADD CONSTRAINT "relatorios_faturamento_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "portal_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Competência fora do formato deixa a linha inalcançável pela rota (que valida YYYY-MM) e
-- invisível na tela — o banco recusa antes.
ALTER TABLE "relatorios_faturamento"
  ADD CONSTRAINT "chk_relatorio_faturamento_competencia"
  CHECK ("competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
