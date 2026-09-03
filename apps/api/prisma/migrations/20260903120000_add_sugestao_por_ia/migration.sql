-- ⚠⚠ ADITIVA E NULA. Colunas novas, sem default e sem backfill.
--
-- A PROPOSTA da IA para a conta do lancamento — dono, 02/09/2026: *"um botao que ao clicar vai
-- analisar os lancamentos e colocar as devidas contas, tendo o contador apenas que verificar"*.
--
-- ⚠⚠ ELAS NAO SAO `contaAplicada`. Aquela e o ATO do contador, e e o que `montarLancamento` le para
-- creditar o caixa; escrever ali seria a IA praticando um lancamento contabil. Aqui e proposta.
-- ⚠ Nenhuma linha existente e tocada: `null` significa "a IA nao opinou", que e a verdade de todas.
ALTER TABLE "lancamentos_declarados" ADD COLUMN "contaSugeridaIa" TEXT;
ALTER TABLE "lancamentos_declarados" ADD COLUMN "creditoSugeridoIa" TEXT;
ALTER TABLE "lancamentos_declarados" ADD COLUMN "justificativaIa" TEXT;
ALTER TABLE "lancamentos_declarados" ADD COLUMN "sugeridaIaModelo" TEXT;
ALTER TABLE "lancamentos_declarados" ADD COLUMN "sugeridaIaEm" TIMESTAMP(3);

-- ⚠ PARA QUE a chamada de IA foi feita. Sem isto o teto mensal do escritorio mistura o assistente
-- do WhatsApp com a classificacao de lancamentos, e nao da para saber para onde o dinheiro foi.
ALTER TABLE "chamadas_ia" ADD COLUMN "finalidade" TEXT;
