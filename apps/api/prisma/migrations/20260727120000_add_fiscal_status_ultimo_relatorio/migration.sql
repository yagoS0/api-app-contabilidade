-- C11 fix: separa "última tentativa" de "último relatório de verdade".
--
-- A trava de 4h da situação fiscal estava ancorada em checked_at, que sobe em TODA tentativa —
-- inclusive quando o SERPRO responde "processando" sem devolver relatório. Resultado: uma
-- tentativa que não trouxe nada iniciava a trava e deixava a empresa 4h sem situação fiscal.
-- Agora a trava usa ultimo_relatorio_em, preenchido só quando um relatório é realmente salvo.
ALTER TABLE "company_fiscal_status" ADD COLUMN IF NOT EXISTS "ultimoRelatorioEm" TIMESTAMP(3);

-- SEM backfill de propósito: a coluna nasce NULL para todo mundo (= destravado).
--
-- Herdar checked_at seria pior do que não fazer nada: é exatamente o valor contaminado pelas
-- tentativas que voltaram "processando", então empresas travadas hoje continuariam travadas
-- justamente pelo bug que esta migration corrige. Como não dá pra distinguir "checked_at de
-- consulta boa" de "checked_at de tentativa vazia", destravamos todo mundo uma vez e o campo
-- passa a ser preenchido só por consultas que realmente trouxerem relatório.
-- Custo: no máximo uma consulta SERPRO extra por empresa, uma única vez.
