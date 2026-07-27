-- Backfill do ultimoRelatorioEm — corrige a decisão da migration 20260727120000.
--
-- Lá eu deixei a coluna NULL pra todo mundo, com medo de herdar um checkedAt "contaminado" por
-- tentativas que voltaram "processando". O efeito colateral foi pior: empresa que JÁ TINHA
-- relatório salvo (PDF + texto + situação) ficou destravada, então todo clique em "Consultar"
-- tentava reconsultar, batia no limite AV02 do SERPRO (que é por CONTRATANTE) e devolvia
-- "aguarde" — parecendo que a situação fiscal não tinha sido salva, quando estava lá.
--
-- Aqui herdamos o checkedAt SÓ para quem comprovadamente tem relatório. O pior caso é a empresa
-- ficar até 4h sem poder reconsultar — muito melhor do que queimar a cota do escritório inteiro
-- reconsultando quem já tem o relatório em mãos.
--
-- Excluímos PROCESSANDO: nesse estado não há relatório concluído, então continua destravada.
UPDATE "company_fiscal_status"
   SET "ultimoRelatorioEm" = "checkedAt"
 WHERE "ultimoRelatorioEm" IS NULL
   AND "checkedAt" IS NOT NULL
   AND ("relatorioPdfFileId" IS NOT NULL OR "texto" IS NOT NULL)
   AND COALESCE("situacao", '') <> 'PROCESSANDO';
