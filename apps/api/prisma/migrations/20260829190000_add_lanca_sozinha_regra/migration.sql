-- ⚠⚠ A REGRA QUE LANÇA SOZINHA — decisão do dono, 29/08/2026.
--
-- > *"todo mês que essa nota aparecer ela já é lançada em despesa"* · *"lança numa data fixa que eu
-- > configuro"*
--
-- ⚠⚠ **`lancaSozinha` NASCE `false` PARA TODAS AS REGRAS EXISTENTES.** Ela é a segunda de DUAS
-- chaves (a outra é a flag `INTEGRACAO_LANCAMENTO_POR_REGRA` do ambiente), e é FORNECEDOR A
-- FORNECEDOR — nunca a carteira inteira de uma vez. Um `DEFAULT true` aqui ligaria a automação em
-- todas as regras aprendidas da base no instante em que a migration rodasse.
--
-- ⚠ `diaDoLancamento` é NULO e não tem default: **a data não se arbitra**. Com `lancaSozinha: true`
-- e o dia nulo, o serviço RECUSA — um dia escolhido pelo sistema afirmaria uma saída de caixa numa
-- data que ninguém decidiu.
--
-- ⚠⚠ ESCRITA E **NÃO APLICADA** — como todas as desta casa. Aplicar em produção é ato do dono, e
-- esta merece atenção redobrada: ela é o que torna o lançamento automático POSSÍVEL (ainda que a
-- flag continue desligando tudo).
ALTER TABLE "regras_contabilizacao" ADD COLUMN "lancaSozinha" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "regras_contabilizacao" ADD COLUMN "diaDoLancamento" INTEGER;
