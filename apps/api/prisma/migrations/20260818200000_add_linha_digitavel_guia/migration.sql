-- LINHA DIGITÁVEL da guia — o número que o cliente digita para pagar.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é decisão do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ E, DE PROPÓSITO, O `schema.prisma` NÃO FOI EDITADO JUNTO. O precedente do projeto
--   (`20260814160000_add_contato_whatsapp_usuario`) edita os dois de uma vez, e ali isso custou
--   só um script de diagnóstico que "para antes". Aqui a tabela é a `"Guide"`, lida sem `select`
--   em várias rotas: um campo no modelo que não existe no banco derruba TODA consulta de guia até
--   a migration ser aplicada. A ordem segura é: **aplicar esta migration primeiro, depois**
--   acrescentar ao model `Guide` do `schema.prisma`:
--
--       /// Linha digitável de arrecadação (48 dígitos, sem máscara), LIDA do documento oficial.
--       /// Só entra número que passou nos cinco dígitos verificadores (FEBRABAN §07–§10) E cuja
--       /// importância bate com o total da guia. Nulo = não foi possível ler — nunca um palpite.
--       linhaDigitavel     String?
--       linhaDigitavelLidaEm DateTime?
--
-- ⚠ NOME DA TABELA CONFERIDO CONTRA AS MIGRATIONS, NUNCA CONTRA O `schema.prisma` (que nomeia
--   MODELS): o model `Guide` não tem `@@map`, e `20260213003000_add_guides_models` cria
--   `CREATE TABLE IF NOT EXISTS "Guide"` — com maiúscula, entre aspas.
--
-- POR QUE COLUNA, E NÃO MAIS UM CAMPO DENTRO DE `extracted` (Json):
--   1. `extracted` já carrega o `rawPayload` do SERPRO (212 KB por guia, com o PDF em base64).
--      Pendurar ali o dado que a TELA DO CLIENTE lê significa arrastar o payload inteiro em toda
--      listagem de guia. O `ParcelamentoService` já evita expor `extracted` ao cliente por isso.
--   2. Uma coluna com nome próprio deixa o invariante visível: neste campo só entra número
--      validado. `extracted.barcode` existe desde sempre no contrato do pdf-reader
--      (`GuideParserClient.js:37`) e nunca foi preenchido em guia nenhuma — um saco de dados
--      opcional não sustenta a promessa "este número pode ser pago".
--   3. `linhaDigitavelLidaEm` permite reprocessar quando o extrator melhorar, sem confundir
--      "ainda não tentei" com "tentei e não deu" (nulo nos dois campos × data sem linha).
--
-- ADITIVA, NULLABLE, SEM BACKFILL. Nulo é a resposta honesta para a guia cuja linha não se
-- conseguiu LER — e é a resposta certa: linha digitável não se deduz de banco + valor +
-- vencimento + número do documento. Um dígito errado manda o dinheiro do cliente para o lugar
-- errado. Ausência é resposta; número errado não é.

ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "linhaDigitavel" TEXT;
ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "linhaDigitavelLidaEm" TIMESTAMP(3);

-- Guarda no BANCO, não só no código: 48 dígitos, começando por "8" (identificação do produto
-- "arrecadação", FEBRABAN §05). Não substitui a validação dos dígitos verificadores — é o piso
-- que impede que um número de outro formato (boleto de cobrança tem 47, chave de NF-e tem 44)
-- entre nesta coluna por um caminho que ninguém previu.
ALTER TABLE "Guide" DROP CONSTRAINT IF EXISTS "Guide_linhaDigitavel_formato";
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_linhaDigitavel_formato"
  CHECK ("linhaDigitavel" IS NULL OR "linhaDigitavel" ~ '^8[0-9]{47}$');
