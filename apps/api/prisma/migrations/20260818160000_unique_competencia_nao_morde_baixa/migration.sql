-- O UNIQUE DE COMPETÊNCIA PASSA A NÃO MORDER AS BAIXAS — que é o que o schema já AFIRMAVA.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- O DEFEITO, MEDIDO
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `POST /firm/companies/:id/entries/:entryId/baixa` grava o lançamento do PRINCIPAL com:
--
--     competencia = a competência da DATA DO PAGAMENTO   (NÃO a da provisão)
--     eventType   = deriveBaixaEventType(provisão)       ("BAIXA_DAS_SIMPLES")
--     origem      = "MANUAL"
--
-- Nada nessa tupla diz QUAL provisão está sendo quitada. Quando a baixa é feita **sem
-- comprovante**, o modal usa a data de HOJE — então toda provisão em atraso, de qualquer mês,
-- aponta para a competência CORRENTE. A primeira baixa do mês ocupa a tupla; a segunda estoura
-- 23505 / P2002 dentro do `$transaction`, cai no `catch` genérico da rota e volta como
-- **500 `internal_error`**, sem motivo na tela.
--
-- Medido em produção (18/08/2026, `scripts/diag-baixa-colisao-competencia.mjs`, só leitura):
-- **16 empresas** com 2+ provisões de DAS abertas mirando 2026-08. ARAUJO BARRETO e TALBOT com
-- 7 meses cada; ATIM, FADINI e ALESSANDRO com 6. Em cada uma, a primeira baixa passa e as demais
-- estouram.
--
-- ⚠ O comentário do `schema.prisma` afirmava que este unique "não morde as BAIXAS" (porque elas
-- nasceriam com `eventType` NULL). Isso é VERDADE para `InssPagamentoService` e para o
-- parcelamento; é **FALSO** para esta rota, que preenche o `eventType` no lançamento do principal
-- de propósito — é ele que alimenta a memória de contas (`AccountingHistorico`). Esta migration
-- faz valer o que o schema já dizia, em vez de mudar a forma do lançamento.
--
-- ⚠ ELE TAMBÉM BLOQUEAVA A BAIXA PARCIAL POR QUOTA. Duas quotas da MESMA provisão pagas no mesmo
-- mês repetem a tupla inteira — e a rota oferece esse fluxo (`saldoInfo`/`quotaNumero`,
-- `statusPagamento: "PARCIAL"`). O unique recusava a segunda quota pelo mesmo 500.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- O QUE ESTE ÍNDICE CONTINUA GUARDANDO — e por que ele NÃO pode simplesmente sumir
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Ele é a **única** trava contra provisão duplicada no caminho do extrato PGDAS/SERPRO.
-- `AccountingEntryGeneratorService.generateEntriesFromCircular` faz um check-then-act:
--
--     findFirst({ portalClientId, competencia, eventType, origem: "SERPRO" })  →  create(...)
--
-- ou seja, lê e depois cria — e este índice é o backstop atômico dessa janela. O outro unique,
-- `(sourceGuideId, eventType)`, **não alcança** esse caminho: a provisão do DAS/Simples nasce do
-- extrato, **sem `sourceGuideId`**, e no Postgres NULLs são distintos em UNIQUE.
--
-- Por isso o índice não é removido: ele vira **PARCIAL**. Provisões e receitas (`tipo <> 'BAIXA'`)
-- continuam exatamente como estavam; só as baixas saem de dentro dele.
--
-- ⚠ `"tipo"` é NOT NULL, então `"tipo" <> 'BAIXA'` é um predicado total — não há o buraco de
-- lógica de três valores que um `<>` sobre coluna anulável abriria (NULL <> 'BAIXA' é NULL, e a
-- linha ficaria fora do índice sem ninguém pedir).
--
-- ⚠ O NOME É PRESERVADO de propósito. O índice nasceu em `20260429120000_add_circular_and_entry_rules`
-- e foi RENOMEADO em `20260519095906_add_historico_sugerido` para
-- `accounting_entries_portalClientId_competencia_eventType_ori_key` (o nome gerado pelo Prisma
-- estourava o limite de 63 caracteres do Postgres). Mantê-lo evita que um `prisma migrate dev`
-- futuro veja duas coisas onde há uma.
--
-- ⚠ NADA A BACKFILLAR, e isso é estrutural: um índice que passa de total para PARCIAL só pode
-- aceitar MAIS linhas do que aceitava. Nenhuma linha existente viola o índice novo — se violasse,
-- já violaria o antigo e não estaria na tabela.
--
-- ⚠ Isto NÃO toca `uq_baixa_guia_linha` nem `uq_baixa_parcela_linha` (as travas de baixa
-- DUPLICADA, ambas já parciais em `tipo = 'BAIXA'`), nem o CHECK `chk_baixa_tipo_linha`, nem
-- `(sourceGuideId, eventType)`. As quatro seguem intactas.

-- DropIndex + CreateIndex, num passo só, e ABORTANDO se o índice esperado não estiver lá
-- (mesma disciplina de `20260808180000_add_parcela`): sem esta guarda, um nome divergente faria a
-- migration criar um índice NOVO ao lado do antigo — o defeito continuaria de pé, em silêncio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'accounting_entries_portalClientId_competencia_eventType_ori_key'
      AND c.relkind = 'i'
      AND n.nspname = current_schema()
  ) THEN
    RAISE EXCEPTION
      'Índice "accounting_entries_portalClientId_competencia_eventType_ori_key" não encontrado. '
      'Ele deveria existir desde 20260519095906_add_historico_sugerido. '
      'Confira o nome real (\\d accounting_entries) antes de prosseguir — criar o índice parcial '
      'sem derrubar o total deixaria o defeito de pé.';
  END IF;
END $$;

DROP INDEX "accounting_entries_portalClientId_competencia_eventType_ori_key";

CREATE UNIQUE INDEX "accounting_entries_portalClientId_competencia_eventType_ori_key"
  ON "accounting_entries" ("portalClientId", "competencia", "eventType", "origem")
  WHERE "tipo" <> 'BAIXA';
