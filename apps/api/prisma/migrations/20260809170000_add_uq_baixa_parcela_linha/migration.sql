-- O CINTO DE BANCO DA BAIXA SEM GUIA.
--
-- ⚠ POR QUE ELE FALTAVA
-- `uq_baixa_guia_linha` (migration 20260808120000) é PARCIAL em `"sourceGuideId" IS NOT NULL`. A
-- baixa por declaração (F2.2, `gerarPagamentoParcelaManual`) nasce com `sourceGuideId` NULL — ela
-- cai FORA daquele índice. Ou seja: o caminho que protege a baixa por guia contra duplicata não
-- alcança a baixa sem guia, e a única proteção dela era a reserva atômica em `parcelas.origemBaixa`.
--
-- Reserva atômica é guarda de APLICAÇÃO. Ela funciona, e o lock de linha do Postgres a sustenta —
-- mas foi a ausência de cinto no banco que deixou a baixa duplicada possível da primeira vez
-- (`eventType` NULL num UNIQUE, onde NULLs são distintos). Guarda de aplicação sem constraint é
-- exatamente o par que produziu aquele defeito.
--
-- ⚠ A CHAVE É A PRESTAÇÃO, NÃO O DOCUMENTO. Sem guia não há `sourceGuideId` para ancorar, então a
-- identidade da linha é `(parcelamento, número da parcela, papel da linha, tributo)`. É o mesmo
-- formato do índice irmão, com a âncora trocada — as duas metades da mesma regra.
--
-- ⚠ `COALESCE("codigoTributo", '')` NÃO É DETALHE. Sem ele, uma baixa de tributo único deixa o campo
-- NULL, os NULLs voltam a ser distintos no UNIQUE, e duas duplicatas passam as duas. É literalmente
-- o defeito do `eventType` que o índice irmão existe para fechar; repeti-lo aqui seria fechar uma
-- porta e deixar a outra aberta.
--
-- ⚠ SEM `CONCURRENTLY`, e é decisão, não esquecimento: o Prisma roda migration DENTRO de transação e
-- `CREATE INDEX CONCURRENTLY` não pode rodar ali. A tabela tem ~610 linhas (medido em produção em
-- 2026-08-09), então o lock é irrelevante — mesma decisão, pelo mesmo motivo, do índice irmão.
--
-- ⚠ NÃO HÁ DADO A CONFLITAR: medido em produção hoje, `parcelas` com `origemBaixa = 'MANUAL'` = 0 e
-- lançamentos de BAIXA sem guia ancorados em parcelamento = 0. O índice nasce sobre conjunto vazio.
--
-- ⚠ O QUE ELE NÃO COBRE, dito para ninguém supor que cobre: linha com `numeroParcela` NULL fica de
-- fora do `WHERE`. Hoje isso é inalcançável por este caminho (prestação sem número só nasce de guia,
-- e prestação COM guia é recusada pela rota com `parcela_tem_guia`) — mas é garantia de FLUXO, não
-- estrutural. Fechá-la de verdade exigiria uma coluna `accounting_entries."parcelaId"`.

CREATE UNIQUE INDEX uq_baixa_parcela_linha
  ON "accounting_entries" ("parcelamentoId", "numeroParcela", "tipoLinha", COALESCE("codigoTributo", ''))
  WHERE "tipo" = 'BAIXA'
    AND "sourceGuideId" IS NULL
    AND "parcelamentoId" IS NOT NULL
    AND "numeroParcela" IS NOT NULL
    AND "tipoLinha" IS NOT NULL;
