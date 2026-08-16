-- A EMPRESA PASSA A TER **N** CÓDIGOS DE SERVIÇO — e quem emite escolhe entre eles.
--
-- ⚠ NÃO APLICADA. Escrita e parada; `prisma migrate deploy` é ato do dono.
--
-- ⚠ NENHUMA FK É CRIADA AQUI — logo, o risco que derrubou a produção não existe nesta migration.
-- (Para quem for editá-la: nome de tabela se confere no que JÁ EXISTE nas migrations, com
--  `grep -rhoE 'REFERENCES "[A-Za-z_]+"' apps/api/prisma/migrations/ | sort -u`, NUNCA no
--  `schema.prisma`, que fala em nomes de MODEL. Foi `REFERENCES "portal_clients"` — quando a
--  tabela é `"PortalClient"` — que fez o Prisma marcar a migration como falha, recusar todas as
--  seguintes com P3009 e impedir o servidor de subir. `"Company"` é o nome real: ele aparece em
--  `REFERENCES "Company"` em migrations já aplicadas e em `ALTER TABLE "Company"` na
--  `20260814120000_add_nfse_emissao_fase1`.)
--
-- ⚠ CONTEXTO QUE TORNA ISTO SEGURO: **a emissão nunca rodou em produção.** Nenhuma variável
-- `NFSE_*` está definida no Railway, `integrationReady()` sempre foi falso e toda emissão parava
-- em `status:"pending"`. E `"codigoServicoNacional"` só ganhou tela em 14/08/2026 (e419f0ac).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) A LISTA — ADITIVA, COM DEFAULT VAZIO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Decisão do dono (16/08/2026): *"ao cadastrar podemos ter mais de um código, a empresa pode usar
-- mais de uma atividade e na hora da emissão ela deve escolher"*.
--
-- ⚠ Coluna NOVA, não substituição: `"codigoServicoNacional"` (singular) CONTINUA e continua sendo
-- o que a DPS leva — é ela que `NfseService.buildMissingFields` exige e que `buildDpsXml` escreve
-- no XML. Duas colunas com significados DIFERENTES (o conjunto habilitado × o que vai nesta nota),
-- não duas com o mesmo — a distinção é a mesma de "TRÊS NÚMEROS DE DAS, TRÊS COLUNAS".
--
-- `TEXT[] NOT NULL DEFAULT '{}'` espelha `"cnaesSecundarios"`, que já existe nesta tabela com essa
-- forma (`String[] @default([])` no schema). Nulo e vazio significariam a mesma coisa aqui — "a
-- empresa não tem código cadastrado" —, e um array não-nulo dispensa a checagem em todo leitor.
ALTER TABLE "Company"
  ADD COLUMN "codigosServicoNacional" TEXT[] NOT NULL DEFAULT '{}';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) O DADO JÁ GRAVADO NÃO PODE SUMIR
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ MEDIDO EM PRODUÇÃO: `"codigoServicoNacional"` está **vazio nas 33 empresas** — o campo só
-- ganhou porta em 14/08/2026 e ninguém o preencheu ainda. Ou seja, este UPDATE deve tocar ZERO
-- linhas hoje.
--
-- Ele existe assim mesmo, e não é cerimônia: entre escrever a migration e o dono aplicá-la, ele
-- vai cadastrar o próprio CNPJ — e um valor digitado nesse intervalo desapareceria da tela nova
-- (que lê a lista) sem desaparecer do banco. Pior que perder: ficar invisível e ainda ser o que a
-- nota carrega.
--
-- ⚠ O `WHERE` é restrito ao que a forma PROVA: exatamente 6 dígitos, que é o `cTribNac`
-- (`item(2)+subitem(2)+desdobro(2)`). Valor com outro comprimento não é promovido a item de lista
-- — normalizá-lo aqui seria adivinhar de que lado falta zero, e o código errado sai como nota
-- emitida com o serviço errado. Ele fica onde está, e o cadastro o recusa com nome próprio na
-- primeira edição.
UPDATE "Company"
   SET "codigosServicoNacional" = ARRAY["codigoServicoNacional"]
 WHERE "codigoServicoNacional" ~ '^[0-9]{6}$'
   AND "codigosServicoNacional" = '{}';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) ⚠ POR QUE NÃO HÁ CHECK AQUI — e isso é decisão, não esquecimento
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- O `cTribNac` tem 6 posições, e a coluna irmã `"codigoMunicipioIbge"` GANHOU um CHECK
-- (`chk_company_codigo_municipio_ibge`, na `20260814120000`) exatamente por esse tipo de razão.
-- Aqui não dá, e o motivo é do Postgres, não de conveniência:
--
--   • conferir CADA ELEMENTO de um array exige `unnest`, que é uma SUBQUERY — e o Postgres proíbe
--     subquery em CHECK ("cannot use subquery in check constraint"). A migration não aplicaria;
--   • a alternativa sem subquery (`array_to_string(col, ',') ~ '^([0-9]{6}(,[0-9]{6})*)?$'`) usa
--     uma função marcada STABLE, não IMMUTABLE, dentro de uma restrição que deveria ser imutável.
--
-- E uma migration que FALHA é o pior desfecho possível neste projeto: foi assim que a produção caiu
-- (o Prisma marca a migration como falha, recusa todas as seguintes com P3009 e o servidor não
-- sobe, porque o start é `prisma:generate && migrate:deploy && node server.js`). Entre uma guarda a
-- mais no banco e o risco de derrubar o deploy, a escolha é óbvia.
--
-- A FORMA CONTINUA GUARDADA, em três lugares que o dado tem de atravessar para chegar na coluna:
--   • `application/company/companyProfile.js` — 6 dígitos por item, senão
--     `company_codigo_servico_nacional_invalid` (400 NOMEADO, que é o que o contador consegue ler;
--     violação de constraint subiria como 500 sem nome);
--   • `application/validators/companySchemas.js` — o campo é declarado (Zod sem `passthrough`);
--   • no front, o valor não é digitado: é ESCOLHIDO na lista oficial versionada.
-- Regressão: `routes/firm/__tests__/companyCamposNfse.test.js`.
