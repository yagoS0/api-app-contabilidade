-- F2.3 — O PARCELAMENTO VIRA CONTRATO, E A GUIA VIRA EVIDÊNCIA OPCIONAL.
--
-- Duas colunas em `parcelamentos`, as duas puramente ADITIVAS: nenhum backfill, nenhum UPDATE em
-- linha existente, nenhuma tabela além desta. Os 3 contratos que existem hoje continuam
-- exatamente como estão — as duas colunas nascem NULAS neles, e NULO tem significado próprio
-- (abaixo).

-- ============================================================================
-- 1) formaPagamento — a INFERÊNCIA vira DECLARAÇÃO
-- ============================================================================
-- Hoje o sistema INFERE débito automático pela ausência de guia
-- (`recalculoParcelamento.temEvidenciaDePagamento`), e o próprio código diz por que essa inferência
-- não pode virar inadimplência: parcelamento em débito automático não tem guia NENHUMA, por
-- definição, e contá-lo como não pago acenderia RESCINDÍVEL em todo contrato saudável.
--
-- ⚠ SEM DEFAULT, E ISSO É A DECISÃO — não um esquecimento. Um default não-nulo seria carimbado nos
-- contratos que já existem, e afirmaria sobre eles um fato do mundo real que ninguém informou:
-- ninguém declarou se aquelas três empresas pagam por guia ou por débito em conta. `DEBITO_
-- AUTOMATICO` como default diria "não espere guia" e esconderia guia faltando; `GUIA_MENSAL` como
-- default diria "esperava guia" e transformaria as prestações sem documento em pendência inventada.
-- Os dois erros nascem da mesma causa: preencher por suposição um campo cuja razão de existir é
-- deixar de supor.
--
-- NULO = "não declarado". Enquanto for nulo, o comportamento é BIT A BIT o de hoje (a inferência
-- por evidência segue valendo). Quando o contador declarar, a declaração passa a ser exibida e
-- conferível — e a prestação sem evidência continua fora do cálculo de risco, porque quem decide
-- atraso é evidência de pagamento, nunca a ausência dela.
ALTER TABLE "parcelamentos" ADD COLUMN "formaPagamento" TEXT;

-- Vocabulário fechado, declarado por nós (não é dado externo). NULL passa — é o terceiro estado.
ALTER TABLE "parcelamentos"
  ADD CONSTRAINT "chk_parcelamento_forma_pagamento"
  CHECK ("formaPagamento" IS NULL OR "formaPagamento" IN ('DEBITO_AUTOMATICO', 'GUIA_MENSAL'));

-- ============================================================================
-- 2) saldoConsolidado — INFORMATIVO, e a fronteira precisa ficar escrita
-- ============================================================================
-- Saldo devedor consolidado DECLARADO (o que o extrato do SERPRO mostra hoje). Serve para exibir e
-- para conferir.
--
-- ⚠ ELE NÃO ALIMENTA LANÇAMENTO NENHUM, NUNCA. A provisão da adesão reconhece SÓ O PRINCIPAL
-- (`ParcelamentoV2Service.linhasProvisao`: D principal / C parcelamento-a-pagar = principal), e isso
-- é decisão do dono com motivo medido: creditar o consolidado reconhecia o encargo DUAS VEZES — uma
-- na adesão e outra a cada parcela paga — e deixava no passivo um resíduo permanente igual a
-- `juros + multa` do contrato, ou seja, parcelamento quitado com saldo vivo em "Parcelamento a
-- Pagar" para sempre.
--
-- Quem ligar esta coluna a uma linha de lançamento reabre exatamente aquele defeito, e ele é
-- silencioso: não gera erro, gera saldo errado.
ALTER TABLE "parcelamentos" ADD COLUMN "saldoConsolidado" DECIMAL(18,2);

-- ============================================================================
-- O QUE ESTA MIGRATION DELIBERADAMENTE **NÃO** FAZ
-- ============================================================================
-- · Não cria estado novo para "parcela paga antes do sistema". A tabela `parcelas` já tem
--   `origemBaixa` (hoje sempre NULA) e `baixadaEm`; a prestação histórica é marcada com
--   `origemBaixa = 'HISTORICO'`, que `parcelaRowQuitada` já conta como quitada e
--   `temEvidenciaDePagamento` já conta como evidência. Coluna nova ali seria uma segunda resposta
--   para uma pergunta que já tem uma.
-- · Não toca em `parcelas`, em `Guide` nem em `accounting_entries`.
-- · Não mexe em `diaPagamento` dos contratos existentes. Os 3 têm o cronograma materializado no dia
--   1 porque o modal nunca coletou o campo; mover data de vencimento de parcela já gravada é
--   decisão do dono, não efeito colateral de migration.
