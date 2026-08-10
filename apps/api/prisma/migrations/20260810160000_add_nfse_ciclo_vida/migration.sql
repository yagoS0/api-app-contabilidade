-- O CICLO DE VIDA DA NFS-e PASSA A CABER NO MODELO.
--
-- Puramente ADITIVA: cinco colunas novas, dois índices e uma unicidade sobre tabela VAZIA.
-- Nenhum UPDATE, nenhum DROP, nenhum DEFAULT carimbado em linha existente, nenhuma mudança de
-- tipo. Toda linha que existe hoje continua bit a bit como está, e todo filtro de receita
-- (`statusEfetivo = 'autorizada'`) e de exclusão (`= 'cancelada'`) segue respondendo o mesmo.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O PROBLEMA, MEDIDO EM PRODUÇÃO (10/08/2026)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 16.128 NFS-e capturadas · 556 marcadas CANCELADA · 0 linhas em "PortalInvoiceEvent".
--
-- Um cancelamento de NFS-e Nacional chega como EVENTO — um documento próprio no lote do ADN. A
-- captura lia esse evento, marcava a nota como cancelada e descartava o resto no mesmo instante:
-- a data do fato, o motivo, o número de sequência e — no evento e105102 — a CHAVE DA NOTA
-- SUBSTITUTA. O resultado era um retrato sem história: 556 notas canceladas das quais não se sabe
-- quando, por quê, nem se foram simplesmente canceladas ou TROCADAS por outra nota.
--
-- ⚠ E há um quarto estado, que é o perigoso: "não temos o evento" se parece com "não houve
-- evento" e significa o oposto. As colunas abaixo existem para que essa diferença possa ser dita.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) O VÍNCULO DA SUBSTITUIÇÃO, NA PRÓPRIA NOTA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A nota substituta declara, ela mesma, quem ela substitui — dentro da DPS, no bloco
-- `<subst><chSubstda>` (leiaute oficial ANEXO_I-SEFIN_ADN-DPS_NFSe v1.01). Isso é diferente do
-- evento: viaja no XML da própria nota, que nós guardamos inteiro em `xmlRaw`.
--
-- É por isso que ESTE dado é recuperável e o do evento não. Medido: 22 notas na base já carregam
-- o bloco, e nenhuma coluna o expressava. `scripts/backfill-substituicao-nfse.mjs` extrai esses
-- pares do XML que já está gravado, sem uma única chamada ao ADN.
--
-- ⚠ Guarda a CHAVE, não o id da outra nota. Um id exigiria que a substituída existisse no nosso
-- banco — e em 4 dos 22 pares medidos ela NÃO existe. A chave registra o vínculo mesmo com a
-- outra ponta faltando, e "aponta para uma nota que não temos" é uma resposta legítima, bem
-- diferente de "não aponta para ninguém".
ALTER TABLE "PortalInvoice" ADD COLUMN "chaveSubstituida" TEXT;
ALTER TABLE "PortalInvoice" ADD COLUMN "motivoSubstituicao" TEXT;

-- A pergunta inversa — "quem substituiu ESTA nota?" — é uma varredura por chave dentro da empresa.
CREATE INDEX "PortalInvoice_clientId_chaveSubstituida_idx"
  ON "PortalInvoice"("clientId", "chaveSubstituida");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) O EVENTO GANHA OS CAMPOS QUE O IDENTIFICAM
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `tpEvento` é o código oficial: 101101 (Cancelamento de NFS-e) · 105102 (Cancelamento por
-- Substituição). ⚠ Ele NÃO vem de um elemento `<tpEvento>` — esse elemento não existe em nenhum
-- dos 62 eventos reais que capturamos. Vem do atributo `Id`, que é
-- `EVT` + chave(50) + tpEvento(6) + nSeqEvento(3).
--
-- `chaveSubstituta` é o lado espelhado de `PortalInvoice.chaveSubstituida`: lá a nota nova diz
-- "eu substituo aquela", aqui o evento da nota velha diz "eu fui substituída por aquela". São os
-- dois lados do mesmo fato, em documentos diferentes, e ter os dois é o que permite fechar o
-- vínculo mesmo quando uma das pontas não foi capturada.
-- (Leiaute oficial: ANEXO_II-SEFIN_ADN-PEDREGEVT_EVT-SNNFSe v1.01, `e105102/chSubstituta`.)
ALTER TABLE "PortalInvoiceEvent" ADD COLUMN "tpEvento" TEXT;
ALTER TABLE "PortalInvoiceEvent" ADD COLUMN "nSeqEvento" INTEGER;
ALTER TABLE "PortalInvoiceEvent" ADD COLUMN "chaveSubstituta" TEXT;

-- Idempotência: recaptura, cursor recuado ou reprocessamento não podem duplicar o mesmo fato.
--
-- ⚠ É SEGURO PORQUE A TABELA ESTÁ VAZIA (0 linhas em produção, verificado antes de escrever esta
-- migration). Criar unicidade sobre tabela povoada exigiria deduplicar antes.
--
-- ⚠ E ela NÃO restringe o caminho NF-e/SEFAZ (`DfeSyncService.applyEvent`), que grava sem
-- `nSeqEvento`: no PostgreSQL, NULLs são DISTINTOS num índice único, então duas linhas com
-- `nSeqEvento` nulo convivem. Isso é deliberado — apertar aquele caminho não é o escopo desta
-- mudança, e ele já engole o erro de escrita num `.catch`.
CREATE UNIQUE INDEX "PortalInvoiceEvent_invoiceId_type_nSeqEvento_key"
  ON "PortalInvoiceEvent"("invoiceId", "type", "nSeqEvento");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION DELIBERADAMENTE **NÃO** FAZ
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- · NÃO introduz `statusEfetivo = 'substituida'`. Seria mudança de DINHEIRO disfarçada de rótulo:
--   todo filtro de receita testa `= 'autorizada'` e todo filtro de exclusão testa `= 'cancelada'`
--   (routes/firm/notas.js:421 esconde da aba, :515 tira dos totais). Um terceiro valor não casa
--   com nenhum dos dois — a nota reapareceria na aba, entraria no total do resumo e continuaria
--   fora do faturamento. Duas telas discordando em silêncio sobre a mesma nota é exatamente o
--   defeito que este projeto mais persegue. A distinção mora no EVENTO e no VÍNCULO, não no
--   status; quem a compõe é `application/notas/cicloNota.js`.
-- · NÃO altera nenhuma linha existente. O backfill dos 22 pares é script separado, com dry-run
--   por padrão, rodado por decisão de quem opera.
-- · NÃO toca nas 62 linhas em que o XML de um evento sobrescreveu a nota (numero/total NULOS,
--   marcadas EMITIDA/autorizada). Elas não são recuperáveis do nosso dado — o XML da nota foi
--   perdido —, e escolher entre reler o ADN e marcá-las como estado desconhecido tem consequência
--   contábil. É decisão do dono, não efeito colateral de migration.
-- · NÃO liga o ledger da Fase 1 (`documentos`/`eventos`, ambas vazias). Continua sendo a resposta
--   estrutural, e continua sendo decisão do dono.
