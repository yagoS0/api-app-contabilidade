-- RETENCAO FEDERAL NO PERFIL DE EMISSAO -- PIS/COFINS/CSLL do art. 30 da Lei 10.833/2003.
--
-- NAO APLICADA. Aplicar e ato do dono. Aditiva, nullable, SEM DEFAULT.
--
-- ⚠⚠ `retencaoFederalArt30` NAO TEM DEFAULT, e isso e a licao de `CadastroFiscal.usaFatorR`
-- (`@default(false)`), que nao distinguia "o contador disse que nao" de "ninguem nunca abriu essa
-- tela". Aqui NULO = ninguem respondeu, e o gerador so retem com `true` EXPLICITO.
--
-- ⚠⚠ E DECLARAR `true` NAO BASTA. Tres coisas decidem a retencao, e so uma e do perfil:
--   1. o REGIME       -- optante do Simples NAO sofre (Lei 10.833, art. 32, III; IN SRF 459/2004,
--                        art. 3, II). ⚠ Nao confundir com o art. 30 §2, que fala de quem PAGA.
--   2. o SERVICO estar na lista do art. 30 -- esta coluna, declarada pelo contador.
--      ⚠⚠ O sistema NAO deriva do CNAE: errar aqui erra nos dois sentidos.
--   3. o TOMADOR ser PJ -- derivado do documento da nota (CPF 11 => nao retem).
-- Mais a dispensa pelo PISO: valor retido <= R$ 10,00 (art. 31 §3, redacao da Lei 13.137/2015).
-- ⚠⚠ O ANTIGO LIMITE DE R$ 5.000 NAO EXISTE MAIS -- a mesma lei REVOGOU o §4, que era a regra de
-- somar os pagamentos do mes. Sistema que ainda o aplique DEIXA DE RETER o que e devido.
--
-- ⚠ `cstPisCofins`: o XSD torna o CST obrigatorio dentro do grupo `piscofins`, e NAO existe em
-- fonte versionada aqui um de-para servico -> CST. Sem ele o grupo nao se monta, e a ausencia e
-- recusa NOMEADA (`NFSE_RETENCAO_FEDERAL_SEM_CST`) -- nunca um "01" fabricado.
--
-- ⚠ O QUE ESTA MIGRATION **NAO** HABILITA: `vRetIRRF` (a aliquota do IRRF vive na legislacao do IR
-- e nao esta versionada aqui) e `vRetCP` (os 11% da Lei 8.212/1991, art. 31, nao confirmados em
-- fonte primaria). Os dois campos existem no leiaute e continuam SEM PRODUTOR, de proposito.

ALTER TABLE "perfis_emissao_nfse"
  ADD COLUMN "retencaoFederalArt30" BOOLEAN,
  ADD COLUMN "cstPisCofins"         TEXT;

-- ⚠ A forma vem do XSD 1.01: `TSTipoCST` enumera 34 valores de DOIS digitos.
-- O CHECK confere a FORMA; o conteudo (o valor ser um dos 34) e conferido pela rota, contra a
-- enumeracao lida do proprio arquivo -- CHECK nao consulta lista.
ALTER TABLE "perfis_emissao_nfse"
  ADD CONSTRAINT "perfis_emissao_nfse_cstPisCofins_forma"
    CHECK ("cstPisCofins" IS NULL OR "cstPisCofins" ~ '^[0-9]{2}$');
