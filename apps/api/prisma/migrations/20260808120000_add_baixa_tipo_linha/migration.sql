-- BAIXA DUPLICADA — o cinto do banco por baixo da reserva atômica da guia.
--
-- POR QUE O UNIQUE QUE JÁ EXISTIA NÃO MORDE
-- `@@unique([sourceGuideId, eventType])` foi desenhado para as PROVISÕES (uma por tributo, cada
-- uma com seu `eventType`) e continua valendo lá. Os lançamentos de BAIXA nascem com `eventType`
-- NULL, e no Postgres NULLs são DISTINTOS em UNIQUE: as duas baixas passavam.
--
-- POR QUE NÃO BASTA UM ÍNDICE PARCIAL EM `sourceGuideId`
-- Uma baixa são N lançamentos de uma perna só (principal, juros, multa, um par por tributo do
-- comprovante), TODOS com o mesmo `sourceGuideId`. Um índice em `sourceGuideId` sozinho recusaria a
-- 2ª e a 3ª linha de uma baixa LEGÍTIMA — derrubaria a baixa inteira em vez de impedir a duplicada.
--
-- A SAÍDA: denormalizar o PAPEL da linha no cabeçalho. `AccountingEntryLine` já carrega
-- `tipoLinha`/`codigoTributo` (Q21); trazê-los para `accounting_entries` é o que dá ao índice uma
-- coluna que SEPARA as linhas legítimas do mesmo lote e REPETE nas duplicadas.
ALTER TABLE "accounting_entries"
  ADD COLUMN "tipoLinha" TEXT,
  ADD COLUMN "codigoTributo" TEXT;

-- BACKFILL DAS BAIXAS EXISTENTES — sem inventar papel nenhum.
--
-- ⚠ ELE NÃO É COSMÉTICO. Um CHECK marcado NOT VALID não valida as linhas ANTIGAS na migration, mas
-- é aplicado em todo INSERT **e UPDATE** posterior — inclusive no UPDATE de uma linha antiga. Sem
-- este backfill, exportar a competência (`updateMany status=EXPORTADO`), editar o lançamento
-- (`PUT /entries/:id`) ou aprovar a conferência de parcelas quebraria em cima de toda baixa
-- gravada antes deste deploy.
--
-- As três regras abaixo são EXATAS, não heurísticas: reproduzem o que o próprio código escrevia.
--   1) `accounting_entry_lines.tipoLinha` — o mesmo dado, já gravado na linha (ParcelamentoV2).
--   2) sufixo do histórico — `SUFIXO_HISTORICO`/`SUFIXO_PAPEL` (" (juros)" / " (multa)") são
--      constantes dos dois serviços que separam a baixa por papel.
--   3) o resto é PRINCIPAL: tanto `separarLinhasPorPapel` quanto `separarPorPapel` chamam de
--      PRINCIPAL todo débito sem papel marcado, e a baixa de INSS paga em dia é um lançamento só,
--      que é o principal.
-- Conferido contra produção antes de escrever: 63 baixas (34 da rota genérica, 26 do INSS, 3 do
-- ParcelamentoV2), e a chave do índice abaixo não colide em NENHUMA delas com esta derivação.
UPDATE "accounting_entries" e
   SET "tipoLinha" = COALESCE(
         (SELECT l."tipoLinha"
            FROM "accounting_entry_lines" l
           WHERE l."entryId" = e."id" AND l."tipoLinha" IS NOT NULL
           ORDER BY l."ordem" LIMIT 1),
         CASE
           WHEN e."historico" LIKE '%(juros)' THEN 'JUROS'
           WHEN e."historico" LIKE '%(multa)' THEN 'MULTA'
           ELSE 'PRINCIPAL'
         END),
       "codigoTributo" = (SELECT l."codigoTributo"
                            FROM "accounting_entry_lines" l
                           WHERE l."entryId" = e."id" AND l."codigoTributo" IS NOT NULL
                           ORDER BY l."ordem" LIMIT 1)
 WHERE e."tipo" = 'BAIXA' AND e."tipoLinha" IS NULL;

-- O CHECK é o que FECHA A JANELA DO NULL. O índice único abaixo é parcial em `tipoLinha IS NOT
-- NULL`; sem esta cobrança, um caminho novo que esquecesse de preencher o papel escaparia do índice
-- exatamente como o `eventType` NULL escapava do unique antigo — o mesmo defeito, com outro nome.
--
-- ⚠ NOT VALID de propósito: passa a valer para INSERT/UPDATE novos sem varrer a tabela. (Com o
-- backfill acima não sobrou linha violando, então um `VALIDATE CONSTRAINT` passaria — é decisão do
-- dono se quer gastar a varredura para deixar o catálogo consistente.)
ALTER TABLE "accounting_entries"
  ADD CONSTRAINT chk_baixa_tipo_linha
  CHECK ("tipo" <> 'BAIXA' OR "tipoLinha" IS NOT NULL)
  NOT VALID;

-- ⚠ `COALESCE("codigoTributo", '')` — NÃO a coluna crua.
--
-- Com a coluna crua, uma baixa de UM tributo só (codigoTributo NULL, que é o caso do INSS e o da
-- rota genérica) voltaria a ter NULLs DISTINTOS entre si: as duas duplicatas passariam as duas, e o
-- índice reproduziria a armadilha que ele existe para fechar.
--
-- POR QUE ESTA FORMA SEPARA O LOTE LEGÍTIMO:
--   · parcela com principal + juros + multa de um tributo →
--     (PARC,'DAS') (JUROS,'DAS') (MULTA,'DAS') (CAIXA,'') — quatro chaves distintas;
--   · comprovante com TJLP → `classificarDocumentoArrecadado` PARTICIONA os itens por código
--     (`itensTjlp` e `itensTributo` nunca compartilham um código), então (JUROS,'0380') não colide
--     com (JUROS,'2089');
--   · DARF do Lucro Presumido com quatro tributos → cada linha carrega o SEU código de receita,
--     logo (PRINCIPAL,'2089') ≠ (PRINCIPAL,'0561') ≠ … Quatro linhas com o código NULO colidiriam,
--     mas quebrar um DARF por tributo sem saber o tributo é o que a regra 1 já proíbe.
-- E por que ela pega a duplicada: a segunda baixa da MESMA guia repete papel e código linha a
-- linha — a colisão é na primeira linha do lote, antes de qualquer valor ir para o razão.
CREATE UNIQUE INDEX uq_baixa_guia_linha
  ON "accounting_entries" ("sourceGuideId", "tipoLinha", COALESCE("codigoTributo", ''))
  WHERE "tipo" = 'BAIXA' AND "sourceGuideId" IS NOT NULL AND "tipoLinha" IS NOT NULL;
