-- POR QUE A AUSÊNCIA DA LINHA DIGITÁVEL PRECISOU DE MAIS DUAS COLUNAS.
--
-- `20260818200000_add_linha_digitavel_guia` trouxe `linhaDigitavel` + `linhaDigitavelLidaEm`. Esse
-- par codifica TRÊS estados, e a tela precisa de QUATRO — porque um dos casos de ausência não é só
-- "não deu": é "deu, e o número lido DISCORDA da guia", e esse caso tem de chegar ao contador
-- CARREGANDO OS DOIS VALORES. Sem isso a divergência cai no mesmo balde do "não achei" e os dois
-- números somem — apagando justamente o conflito que precisa ser visto.
--
-- Caso real, medido no banco local (`scripts/diag-linha-digitavel.mjs`, 18/08/2026):
--   `PGDASD-DAS-44742042202605001.pdf` traz R$ 790,79 impressos na linha e a guia está gravada com
--   R$ 100,00. A linha é internamente íntegra (os cinco DVs fecham) — o que não bate é a
--   comparação com a guia. Não sabemos qual dos dois números está errado, então a linha NÃO é
--   mostrada; mas esconder o conflito é pior que não ter o número.
--
-- A MÁQUINA DE ESTADOS COMPLETA (escrita aqui porque quem ler daqui a seis meses teria de
-- reconstruí-la a partir de quatro colunas soltas):
--
--   lidaEm | linhaDigitavel | motivo      | valorLido   | significado
--   -------+----------------+-------------+-------------+---------------------------------------
--   NULL   | —              | —           | —           | NÃO TENTAMOS (guia antiga, ou sem PDF)
--   data   | preenchida     | NULL        | NULL        | TEMOS A LINHA
--   data   | NULL           | preenchido  | preenchido  | DIVERGÊNCIA — mostra os dois valores
--   data   | NULL           | preenchido  | NULL        | TENTAMOS E NÃO DEU
--
-- ⚠ `linhaDigitavelLidaEm` é gravado em TODA tentativa, inclusive nas que recusam. É ele, sozinho,
--   que separa "não tentamos" de "tentamos e não deu" — sem isso os dois voltam a ser o mesmo
--   balde, que é exatamente o defeito que estas colunas existem para consertar.

ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "linhaDigitavelMotivo" TEXT;
ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "linhaDigitavelValorLidoCentavos" INTEGER;

-- ⚠⚠ INVARIANTE QUE DECIDE SE `linhaDigitavelValorLidoCentavos` AJUDA OU MENTE.
--
-- As recusas do extrator têm NATUREZAS DIFERENTES, e elas não valem a mesma coisa:
--
--   • `valor_divergente_do_documento` — os 5 DVs FECHARAM. A linha é internamente íntegra e o que
--     não bateu foi a comparação com o `Guide.valor`. Aqui o valor codificado nas posições 05–15 é
--     dado CONFIÁVEL: o documento diz aquilo. É legítimo imprimir "a linha traz R$ 790,79".
--
--   • `dv_de_bloco_nao_confere`, `dv_geral_nao_confere`, `tamanho_diferente_de_48`,
--     `primeiro_digito_nao_e_8`, `identificador_de_valor_desconhecido`,
--     `linha_digitavel_nao_encontrada_no_texto`, … — a linha NÃO é íntegra. Um valor extraído dali
--     saiu de uma sequência que já se provou corrompida; gravá-lo e imprimi-lo seria afirmar um
--     número lido de algo que não passou na própria conferência — inventar pela porta dos fundos.
--
-- Por isso: `linhaDigitavelValorLidoCentavos` é preenchido EXCLUSIVAMENTE no caminho
-- `valor_divergente_do_documento`. Em toda outra recusa fica NULL, e a tela diz "não foi possível
-- ler", sem número. Esta é a invariante que impede este campo de virar a porta de saída para o
-- palpite que a coluna `linhaDigitavel` fecha na entrada. Ela é travada por teste em
-- `src/application/guides/__tests__/lerLinhaDigitavelDoPdf.test.js`.
--
-- INTEIRO DE CENTAVOS, nunca float: valor monetário em ponto flutuante volta como 790.7899999.

-- Uma linha VÁLIDA e um MOTIVO DE RECUSA não coexistem. Sem esta guarda, uma escrita futura pode
-- deixar os dois preenchidos e a tela terá de escolher em qual acreditar — e quem escolhe em
-- silêncio acaba escolhendo errado. A guarda mora no BANCO pelo mesmo motivo do CHECK de formato:
-- o caminho que ninguém previu também passa por aqui.
ALTER TABLE "Guide" DROP CONSTRAINT IF EXISTS "Guide_linhaDigitavel_sem_motivo";
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_linhaDigitavel_sem_motivo"
  CHECK ("linhaDigitavel" IS NULL OR "linhaDigitavelMotivo" IS NULL);

-- ⚠ DE PROPÓSITO, NENHUM CHECK EM `linhaDigitavelMotivo`. O catálogo de recusas vai crescer, e uma
-- constraint de lista fechada obrigaria uma migration a cada motivo novo. A lista fechada mora na
-- TELA, como já acontece em `apuracao-v2/lib/pendenciaTela.js` e `guides/list/lib/estadoVazioGuias.js`:
-- de-para explícito, e motivo NÃO CATALOGADO não ganha frase inventada — vira texto neutro com o
-- valor cru sobrevivendo no `title`, para uma auditoria poder recuperá-lo. Enum novo não se conclui
-- por semelhança.
