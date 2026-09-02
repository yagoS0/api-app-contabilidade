-- ⚠⚠ A SÉRIE GANHA DIA, E O CLIENTE PODE MEXER (31/08/2026)
--
-- Dono: "eu quero que entre em algum dia, pode ser no dia em que a nota foi emitida" e
-- "pode ser excluído uma saída pelo usuário. ou alterado a data" — escopo: a série INTEIRA.
--
-- ⚠ Todas as colunas são NULÁVEIS e sem DEFAULT: nenhuma série existente afirma dia nenhum, e um
-- default aqui inventaria uma decisão do cliente que ele nunca tomou.
-- ⚠⚠ `diaDoMes` é SEPARADO de `baseDaObservacao.dia` (a estimativa) porque a varredura reescreve a
-- base a cada rodada — no mesmo campo, ela apagaria a correção do cliente todo mês.
ALTER TABLE "series_recorrentes" ADD COLUMN "diaDoMes" INTEGER;
ALTER TABLE "series_recorrentes" ADD COLUMN "diaDefinidoPor" TEXT;
ALTER TABLE "series_recorrentes" ADD COLUMN "diaDefinidoEm" TIMESTAMP(3);

-- ⚠⚠ Excluída pelo CLIENTE não é `estado = 'RECUSADA'`: aquela palavra é do CONTADOR, e reusá-la
-- atribuiria a ele uma decisão que não tomou. A linha some do fluxo e CONTINUA na Conferência.
ALTER TABLE "series_recorrentes" ADD COLUMN "excluidaPeloClienteEm" TIMESTAMP(3);
ALTER TABLE "series_recorrentes" ADD COLUMN "excluidaPeloClientePor" TEXT;
