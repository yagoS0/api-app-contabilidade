-- A ALIQUOTA DO ISSQN NO PERFIL DE EMISSAO -- quem declara e o CONTADOR.
--
-- Decisao do dono, 01/09/2026: "o contador declara a aliquota de ISS para reter, mas o cliente na
-- tela dele deve poder selecionar se e retido ou nao". A retencao depende do TOMADOR daquela nota;
-- a aliquota depende da EMPRESA. Por isso a caixa fica na tela do cliente e o numero vem daqui.
--
-- NAO APLICADA. Aplicar e ato do dono. Aditiva, nullable, sem DEFAULT:
-- NULO = "o contador nao declarou", nunca "zero por cento".
--
-- ATENCAO: ter esta coluna preenchida NAO quer dizer que a aliquota vai a nota. O campo `pAliq` da
-- DPS e PROIBIDO num cenario e OBRIGATORIO em outro, e os dois sao rejeicao:
--   E0625/E0631  Simples, apuracao pelo SN, SEM retencao  -> PROIBIDO
--   E0621/E0628  Simples, apuracao pelo SN, COM retencao  -> OBRIGATORIO (minimo 1,8%)
--   E0635/E0640  Simples, apuracao FORA do SN             -> depende do convenio do municipio
--   E0617/E0619  nao optante                              -> depende do convenio do municipio
-- Quem decide e `application/nfse/pAliqDaDps.js`, e ele so emite onde a norma PROVA.
--
-- O tipo: `Decimal(4,2)`. O leiaute (`TSDec1V2` = `0|[0-9]{1}(\.[0-9]{2})?`) aceita UM digito
-- inteiro e DUAS casas -- no maximo 9,99%. O ISS tem teto de 5% (LC 116, art. 8-A), entao o CHECK
-- de 0 a 10 e folgado de proposito; quem recusa o que nao cabe no campo e o gerador, nomeando.

ALTER TABLE "perfis_emissao_nfse" ADD COLUMN "pAliq" DECIMAL(4,2);

ALTER TABLE "perfis_emissao_nfse"
  ADD CONSTRAINT "perfis_emissao_nfse_pAliq_faixa"
    CHECK ("pAliq" IS NULL OR ("pAliq" >= 0 AND "pAliq" < 10));
