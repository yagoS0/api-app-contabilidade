-- ESTORNO DA BAIXA — auditoria própria + contra-lançamento em mês fechado.
--
-- POR QUE UMA TABELA, E NÃO COLUNAS NO LANÇAMENTO
-- No mês ABERTO o estorno APAGA os lançamentos de baixa. Auditoria gravada na linha apagada é
-- auditoria que some junto com o fato que ela deveria explicar — e "quem desfez esta baixa, quando
-- e por quê" é exatamente a pergunta que se faz meses depois, quando o número não bate e o
-- lançamento já não existe. A tabela sobrevive aos dois modos.
--
-- ⚠ `entryIdOriginal` é TEXTO SEM FK, de propósito. A linha que ele aponta pode ter sido apagada
-- pelo próprio estorno; uma FK com SET NULL zeraria justamente o dado que dá sentido ao registro,
-- e uma FK com RESTRICT impediria o estorno de acontecer. O mesmo vale para `historicoOriginal` e
-- `valorOriginal`: eles são CÓPIA, não referência — o registro tem de continuar legível sozinho.
CREATE TABLE "estornos_baixa" (
  "id"                    TEXT NOT NULL,
  "portalClientId"        TEXT NOT NULL,

  -- O QUE FOI DESFEITO (cópia imutável — a linha original pode não existir mais)
  "entryIdOriginal"       TEXT NOT NULL,
  "competenciaOriginal"   TEXT NOT NULL,
  "historicoOriginal"     TEXT NOT NULL,
  "valorOriginal"         DECIMAL(18,2) NOT NULL,
  "tipoLinha"             TEXT,
  "codigoTributo"         TEXT,
  "guideId"               TEXT,
  "parcelamentoId"        TEXT,
  "openEntryId"           TEXT,

  -- COMO FOI DESFEITO
  --   DELECAO           = mês aberto: o lançamento foi apagado (comportamento histórico)
  --   CONTRA_LANCAMENTO = mês fechado: o lançamento FICA e nasce um espelho invertido na
  --                       competência aberta. Ver o comentário da rota `POST .../estorno`.
  "modo"                  TEXT NOT NULL,
  "contraLancamentoId"    TEXT,
  "competenciaContra"     TEXT,

  -- QUEM, QUANDO E POR QUÊ — `motivo` é NOT NULL e é a razão de esta tabela existir.
  -- Estorno de baixa confirmada é o tipo de operação que alguém questiona meses depois; sem o
  -- motivo, o registro responde "o quê" e deixa "por quê" para a memória de quem clicou.
  "motivo"                TEXT NOT NULL,
  "estornadoPorUserId"    TEXT,
  "estornadoEm"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- O RASTRO DA TRANSIÇÃO ADMINISTRATIVA (parcelaStateMachine.js)
  "parcelaEstadoAnterior" TEXT,
  "parcelaEstadoNovo"     TEXT,
  -- Recálculo disparado logo após o estorno (riscoRescisao.js). Guardado porque é o número que
  -- justifica a urgência — ou a falta dela — no momento em que a decisão foi tomada.
  "riscoNivel"            TEXT,
  "riscoEmAtraso"         INTEGER,

  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "estornos_baixa_pkey" PRIMARY KEY ("id"),
  -- Motivo em branco é o mesmo que motivo ausente. A validação da rota recusa antes, com mensagem;
  -- este CHECK é o que garante que NENHUM caminho de escrita futuro grave um estorno mudo.
  CONSTRAINT "chk_estorno_motivo" CHECK (length(btrim("motivo")) >= 5),
  CONSTRAINT "chk_estorno_modo" CHECK ("modo" IN ('DELECAO', 'CONTRA_LANCAMENTO'))
);

CREATE INDEX "estornos_baixa_portalClientId_idx" ON "estornos_baixa" ("portalClientId");
CREATE INDEX "estornos_baixa_guideId_idx" ON "estornos_baixa" ("guideId");
CREATE INDEX "estornos_baixa_entryIdOriginal_idx" ON "estornos_baixa" ("entryIdOriginal");

ALTER TABLE "estornos_baixa"
  ADD CONSTRAINT "estornos_baixa_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠ O contra-lançamento TEM FK (SET NULL): ele é uma linha viva do razão da competência aberta, e
-- se alguém o apagar o registro do estorno tem de deixar de apontar para um id inexistente. É o
-- oposto de `entryIdOriginal`, que é cópia justamente porque nasce fadado a sumir.
ALTER TABLE "estornos_baixa"
  ADD CONSTRAINT "estornos_baixa_contraLancamentoId_fkey"
  FOREIGN KEY ("contraLancamentoId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── O contra-lançamento, do lado do lançamento ───────────────────────────────────────────────
--
-- ⚠ POR QUE O CONTRA-LANÇAMENTO **NÃO** É `tipo:'BAIXA'` — este era o furo mais provável da fase.
--
-- Se ele nascesse BAIXA, colidiria com as DUAS travas que a migration anterior
-- (`20260808120000_add_baixa_tipo_linha`) acabou de instalar:
--
--   1. `CHECK chk_baixa_tipo_linha` cobraria `tipoLinha` — o que até seria fácil de satisfazer,
--      já que o espelho tem o mesmo papel da linha original.
--   2. `UNIQUE uq_baixa_guia_linha ("sourceGuideId","tipoLinha",COALESCE("codigoTributo",''))
--      WHERE tipo='BAIXA'` **recusaria a gravação com 23505**. E recusaria com razão, pela lógica
--      dela: o estorno em mês fechado NÃO apaga a baixa original, então as duas linhas coexistem
--      com a mesma guia, o mesmo papel e o mesmo código de receita — que é, letra por letra, a
--      assinatura de uma baixa DUPLICADA. O índice não tem como distinguir "a segunda baixa" de
--      "o espelho da primeira": para ele são a mesma chave.
--
-- Contornar isso mexendo no índice (tirando o COALESCE, ou acrescentando uma coluna à chave) seria
-- reabrir a janela que ele existe para fechar. Contornar com um papel inventado ('ESTORNO_PARC')
-- seria mentir sobre o papel da linha para escapar de uma trava — pior ainda.
--
-- A saída é semântica, não sintática: **o contra-lançamento não é uma baixa**. Baixa é o que
-- amortiza o passivo; o espelho invertido faz o contrário, devolve o passivo. Chamá-lo de BAIXA
-- estava errado antes de qualquer índice — e `computeSaldoProvisao`, que soma os débitos não-
-- acréscimo de tudo que pendura em `openEntryId`, contaria o débito de CAIXA do espelho como se
-- fosse MAIS amortização, levando o passivo para o lado errado em dobro.
--
-- Com `tipo='ESTORNO'`, as duas travas ficam inertes por construção (ambas são parciais em
-- `tipo='BAIXA'`) sem que nenhuma delas seja afrouxada, e `computeSaldoProvisao` passa a subtrair.
ALTER TABLE "accounting_entries" ADD COLUMN "estornoDeEntryId" TEXT;

CREATE INDEX "accounting_entries_estornoDeEntryId_idx" ON "accounting_entries" ("estornoDeEntryId");

-- Sem FK: o alvo é uma baixa de mês FECHADO, que este fluxo justamente não apaga — mas um DELETE
-- futuro por outra porta (reabrindo a competência, por exemplo) não pode ficar bloqueado por um
-- registro de estorno, nem apagar o espelho em cascata. Mesma decisão de `entryIdOriginal`.
