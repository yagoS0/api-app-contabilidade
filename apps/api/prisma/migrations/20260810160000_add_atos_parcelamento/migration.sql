-- ATOS ADMINISTRATIVOS DO PARCELAMENTO — excluir o contrato, desfazer a rescisão.
--
-- POR QUE UMA TABELA, E NÃO COLUNAS NO `parcelamentos`
-- O ato principal que ela registra APAGA a linha de `parcelamentos`. Auditoria gravada na linha
-- apagada some junto com o fato que ela deveria explicar — e "quem excluiu o parcelamento nº 3, e
-- por quê?" é exatamente a pergunta que se faz meses depois, quando o contrato já não existe.
-- Mesma decisão (e mesmo desenho) de `estornos_baixa`, na migration 20260808150000.
--
-- ⚠ `parcelamentoId` é TEXTO SEM FK, de propósito. O contrato que ele identifica normalmente NÃO
-- EXISTE MAIS quando este registro é lido. Uma FK com SET NULL zeraria justamente o dado que dá
-- sentido ao registro; uma com RESTRICT impediria a exclusão de acontecer. O mesmo vale para
-- `labelOriginal`, `numeroParcelamentoOriginal` e `detalhe`: são CÓPIA, não referência.
CREATE TABLE "atos_parcelamento" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "parcelamentoId" TEXT NOT NULL,

  -- EXCLUSAO           = o contrato deixou de existir para o escritório
  -- RESCISAO_DESFEITA  = a rescisão foi desfeita e o contrato voltou a ATIVO
  "ato" TEXT NOT NULL,

  -- ── O CONTRATO, COMO ELE ERA (cópia imutável) ─────────────────────────────────────────────
  "labelOriginal"              TEXT NOT NULL,
  "tipoOriginal"               TEXT,
  "numeroParcelamentoOriginal" TEXT,
  "statusOriginal"             TEXT NOT NULL,
  "competenciaInicial"         TEXT,
  "totalValueOriginal"         DECIMAL(18,2),

  -- ── O QUE FOI DESFEITO, EM NÚMEROS ────────────────────────────────────────────────────────
  -- São os MESMOS números que a confirmação mostrou ao contador antes do clique. Guardá-los é o
  -- que permite conferir, depois, se o que ele viu foi o que aconteceu.
  "prestacoesRemovidas"      INTEGER NOT NULL DEFAULT 0,
  "prestacoesQuitadas"       INTEGER NOT NULL DEFAULT 0,
  "guiasDesvinculadas"       INTEGER NOT NULL DEFAULT 0,
  "lancamentosApagados"      INTEGER NOT NULL DEFAULT 0,
  "lancamentosPreservados"   INTEGER NOT NULL DEFAULT 0,
  "contraLancamentosCriados" INTEGER NOT NULL DEFAULT 0,
  "valorTotalDesfeito"       DECIMAL(18,2) NOT NULL DEFAULT 0,
  "competenciasFechadas"     TEXT,

  -- DELECAO           = nada em competência fechada: as linhas saíram
  -- CONTRA_LANCAMENTO = sobrou linha em mês fechado: ela FICA e nasce o espelho invertido
  --                     (`tipo='ESTORNO'`) na competência de HOJE. Ver `contraLancamento.js`.
  "modo"              TEXT NOT NULL,
  "competenciaContra" TEXT,

  -- ⚠ `false` quer dizer que a linha de `parcelamentos` SOBREVIVEU, com `status='EXCLUIDO'`. Ela é a
  -- âncora do grupo que `computeFechamentoBlockers` usa para somar D/C dos lançamentos de UMA PERNA
  -- SÓ do parcelamento; sem ela (`accounting_entries.parcelamentoId` é ON DELETE SET NULL) cada
  -- lançamento preservado passaria a ser avaliado sozinho e viraria `desbalanceado`, travando o
  -- fechamento daquele mês para sempre.
  "cabecalhoRemovido" BOOLEAN NOT NULL DEFAULT false,

  -- QUEM, QUANDO E POR QUÊ — `motivo` é NOT NULL e é a razão de esta tabela existir.
  "motivo"             TEXT NOT NULL,
  "executadoPorUserId" TEXT,
  "executadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Risco de rescisão logo APÓS o ato. Só faz sentido no RESCISAO_DESFEITA: é o contrato que volta
  -- a existir, e ele pode voltar já rescindível — o número que justifica (ou não) a urgência.
  "riscoNivel"    TEXT,
  "riscoEmAtraso" INTEGER,

  -- A cópia item a item do que saiu (lançamentos e guias). No modo DELECAO é a ÚNICA coisa que resta
  -- deles: um registro que só dissesse "5 lançamentos" não responde a pergunta que alguém vai fazer.
  "detalhe" JSONB,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "atos_parcelamento_pkey" PRIMARY KEY ("id"),
  -- Motivo em branco é o mesmo que motivo ausente. A rota recusa antes, com mensagem legível; este
  -- CHECK é o que garante que NENHUM caminho de escrita futuro grave um ato mudo.
  CONSTRAINT "chk_ato_parc_motivo" CHECK (length(btrim("motivo")) >= 5),
  CONSTRAINT "chk_ato_parc_modo"   CHECK ("modo" IN ('DELECAO', 'CONTRA_LANCAMENTO')),
  CONSTRAINT "chk_ato_parc_ato"    CHECK ("ato"  IN ('EXCLUSAO', 'RESCISAO_DESFEITA'))
);

CREATE INDEX "atos_parcelamento_portalClientId_idx" ON "atos_parcelamento" ("portalClientId");
CREATE INDEX "atos_parcelamento_parcelamentoId_idx" ON "atos_parcelamento" ("parcelamentoId");
CREATE INDEX "atos_parcelamento_ato_idx"            ON "atos_parcelamento" ("ato");

ALTER TABLE "atos_parcelamento"
  ADD CONSTRAINT "atos_parcelamento_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
