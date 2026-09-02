-- NBS E IBS/CBS NO PERFIL DE EMISSÃO — quatro colunas que o CONTADOR declara.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ ADITIVA E INERTE: quatro colunas NULLABLE numa tabela que a `20260901120000` criou e que
-- ainda não existe em produção. Sem default, sem backfill, sem tocar em coluna alheia.
--   NULO = "o contador não declarou". Ele NÃO significa "não se aplica", e é por isso que não há
--   `DEFAULT`: a lição de `CadastroFiscal.usaFatorR` (`@default(false)`), que não distinguia "o
--   contador disse que não" de "ninguém nunca abriu essa tela".
--
-- ⚠⚠ ENQUANTO NINGUÉM PREENCHER, NADA MUDA NO XML. Não é promessa: `<cNBS>` só é escrito quando
-- `codigoNbs` tem valor, e hoje toda linha nasce nula. Ou seja, esta migration + a flag do perfil
-- ligada continuam produzindo a MESMA nota de hoje até um contador declarar algo.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE O `cNBS` FICA NA FORMA PONTUADA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- A DPS quer `[0-9]{9}` (`TSCodNBS`). A tabela oficial publica `1.1502.10.00`, e é assim que uma
-- pessoa lê e confere. Guardar os nove dígitos crus tornaria a coluna impossível de cruzar com a
-- tabela sem reconverter, e esconderia a distinção que mais importa: dos 1.210 códigos da NBS,
-- **918 são terminais e 292 são níveis intermediários da hierarquia**, que NÃO cabem na DPS.
-- A conversão e a recusa nomeada moram em `nbsParaDps` (`application/fiscal/nbs/`).
--
-- ⚠ O CHECK abaixo confere a FORMA pontuada, não a existência na tabela — CHECK não consulta
-- lista. Quem prova que o código existe e é TERMINAL é a rota, na escrita, e o gerador, no
-- pré-voo. É a mesma divisão de `codigosServicoNacional`, cuja coluna também não tem CHECK.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ O `CST` NÃO TEM LISTA VERSIONADA — E ISSO É DECLARADO, NÃO ESCONDIDO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- O XSD 1.01 define `TSRTCCodSitTrib` como `[0-9]{3}` e **não enumera nada**; o ANEXO_I descreve
-- o campo ("Código de Situação Tributária do IBS e da CBS") e também não traz a lista. As regras
-- E1540+ referenciam ATRIBUTOS de uma tabela oficial de `cClassTrib` (redutores, exigência de
-- grupo de tributação regular) que este projeto não tem.
--
-- Medido: os 28 `cClassTrib` do ANEXO VIII têm cinco prefixos de três dígitos — `000`, `011`,
-- `200`, `400` e `820` —, que PARECEM CSTs. Parecer não é fonte. O sistema SUGERE marcando a
-- incerteza; quem declara é o contador. É a mesma decisão já registrada para a categoria de
-- presunção do Lucro Presumido: derivar virou sugerir.
--
-- ⚠ E o `cIndOp` tem tabela própria — o **ANEXO C** (regra E0901) —, que também não está
-- versionado aqui. Conferimos contra o ANEXO VIII, que é SUBCONJUNTO: mais estrito do que a
-- norma exige, portanto na direção segura. Um código legítimo do ANEXO C que não apareça no
-- ANEXO VIII seria recusado por nós — falha fechada, e nomeada.

ALTER TABLE "perfis_emissao_nfse"
  ADD COLUMN "codigoNbs"        TEXT,
  ADD COLUMN "ibscbsCIndOp"     TEXT,
  ADD COLUMN "ibscbsCst"        TEXT,
  ADD COLUMN "ibscbsCClassTrib" TEXT;

-- ⚠ Os CHECK conferem a FORMA, e a forma vem do XSD 1.01:
--   `TSCodNBS`            [0-9]{9}  ← mas a coluna guarda a forma PONTUADA (ver acima)
--   `TSRTCCodIndOp`       [0-9]{6}
--   `TSRTCCodSitTrib`     [0-9]{3}
--   `TSRTCCodClassTrib`   [0-9]{6}
-- ⚠ NULL passa em todos, de propósito: "não declarado" é estado legítimo e é o de toda linha hoje.
ALTER TABLE "perfis_emissao_nfse"
  ADD CONSTRAINT "perfis_emissao_nfse_codigoNbs_forma"
    CHECK ("codigoNbs" IS NULL OR "codigoNbs" ~ '^[0-9]\.[0-9]{4}(\.[0-9]{1,2}){0,2}$'),
  ADD CONSTRAINT "perfis_emissao_nfse_ibscbsCIndOp_forma"
    CHECK ("ibscbsCIndOp" IS NULL OR "ibscbsCIndOp" ~ '^[0-9]{6}$'),
  ADD CONSTRAINT "perfis_emissao_nfse_ibscbsCst_forma"
    CHECK ("ibscbsCst" IS NULL OR "ibscbsCst" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "perfis_emissao_nfse_ibscbsCClassTrib_forma"
    CHECK ("ibscbsCClassTrib" IS NULL OR "ibscbsCClassTrib" ~ '^[0-9]{6}$');
