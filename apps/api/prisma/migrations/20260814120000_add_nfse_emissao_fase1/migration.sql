-- EMISSOR DE NFS-e — FASE 1: município emissor, identidade da nota e desfecho da emissão.
--
-- ⚠ NÃO APLICADA. Escrita e parada, por instrução do dono. `prisma migrate deploy` é ato dele.
--
-- ⚠ NENHUMA FK É CRIADA AQUI — logo, o risco que derrubou a produção não existe nesta migration.
-- (Para quem for editá-la: nome de tabela se confere no que JÁ EXISTE nas migrations, com
--  `grep -rhoE 'REFERENCES "[A-Za-z_]+"' apps/api/prisma/migrations/ | sort | uniq -c`, NUNCA no
--  `schema.prisma`, que fala em nomes de MODEL. Foi `REFERENCES "portal_clients"` — quando a
--  tabela é `"PortalClient"` — que fez o Prisma marcar a migration como falha, recusar todas as
--  seguintes com P3009 e impedir o servidor de subir, já que o start é
--  `prisma:generate && migrate:deploy && node server.js`.)
--
-- As duas tabelas tocadas, `"Company"` e `"ServiceInvoice"`, são as do schema inicial e aparecem
-- com esses nomes exatos em migrations já aplicadas (`"Company"` é referenciada 5 vezes).
--
-- ⚠ CONTEXTO QUE TORNA ISTO SEGURO: **a emissão nunca rodou em produção.** Nenhuma variável
-- `NFSE_*` está definida no Railway, `integrationReady()` sempre foi falso e toda emissão parava
-- em `status:"pending"`. Não há dado legado a preservar nem comportamento a manter.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) O MUNICÍPIO EMISSOR (`cLocEmi`) GANHA CAMPO — E NASCE VAZIO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `buildDpsId`/`buildDpsXml` liam `company.codigoMunicipioIbge` e `company.codigoMunicipio`.
-- **Nenhum dos dois existia no model `Company`** — os dois eram `undefined`, a expressão caía no
-- env `NFSE_COD_MUNICIPIO` (não definido), e o `cLocEmi` saía `"0000000"`. Município zerado
-- derruba a emissão inteira.
--
-- ⚠ **SEM BACKFILL, E ISSO É A DECISÃO.** O município da empresa hoje existe só como TEXTO em
-- `"PortalClient"."municipio"`/`"uf"` (medido: 33 de 33 preenchidos, 32 no Rio de Janeiro). O
-- código IBGE não existe em lugar nenhum do projeto, e converter nome→IBGE exige a tabela de
-- municípios do IBGE, que não temos. Um `UPDATE … WHERE municipio ILIKE 'Rio de Janeiro'` acertaria
-- 32 linhas e ensinaria a fazer o mesmo com as próximas — e o de-para por nome erra em homônimo
-- ("Bom Jesus" existe em 8 estados), com o erro aparecendo só como nota emitida no município
-- errado. Enquanto a coluna estiver nula a emissão é RECUSADA com motivo
-- (`NFSE_MUNICIPIO_NAO_CONFIGURADO`), nunca completada por palpite.
--
-- COMO ELA SERÁ PREENCHIDA é pergunta em aberto para o dono — as três saídas estão descritas no
-- relatório da Fase 1. Nenhuma foi escolhida aqui.
ALTER TABLE "Company" ADD COLUMN "codigoMunicipioIbge" TEXT;

-- 7 dígitos, ou nada. O IBGE de município tem 7 posições (2 de UF + 5); qualquer outra coisa nesta
-- coluna vira `cLocEmi` inválido, e o `padStart` que existia no código transformava lixo curto em
-- código plausível ("3304" virava "0003304"). O CHECK impede que o dado errado sequer entre.
ALTER TABLE "Company"
  ADD CONSTRAINT "chk_company_codigo_municipio_ibge"
  CHECK ("codigoMunicipioIbge" IS NULL OR "codigoMunicipioIbge" ~ '^[0-9]{7}$');

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) O DESFECHO DA EMISSÃO — motivo em campo próprio, camadas separadas
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Timeout, DNS, 500 do provedor e recusa da Receita viravam todos `status:"rejected"`, sem coluna
-- de motivo: a razão existia só no `log.error` de `NfseService.js:1148-1165`. Pior, as validações
-- NOSSAS (`MISSING_P_TOT_TRIB_SN`, `MISSING_TOMADOR_ADDRESS`) são lançadas de dentro do mesmo
-- `try` e caíam no mesmo balde — nota que nunca saiu da nossa máquina ficava gravada como recusada
-- pela Receita.
ALTER TABLE "ServiceInvoice" ADD COLUMN "falhaCamada"   TEXT;
ALTER TABLE "ServiceInvoice" ADD COLUMN "falhaCodigo"   TEXT;
ALTER TABLE "ServiceInvoice" ADD COLUMN "falhaMensagem" TEXT;
ALTER TABLE "ServiceInvoice" ADD COLUMN "falhaCorrecao" TEXT;
ALTER TABLE "ServiceInvoice" ADD COLUMN "falhaEm"       TIMESTAMP(3);

-- Vocabulário fechado. Sem ele a coluna aceita qualquer string e a distinção se perde por digitação
-- — que é o estado do qual estamos saindo.
--
-- ⚠ `TRANSPORTE` é a camada que justifica o campo existir: desfecho DESCONHECIDO. Como **não há
-- inutilização na NFS-e** (varrido nos 16 eventos do Anexo II e nas RNs do Anexo I), número pulado
-- é buraco permanente e reusar às cegas arrisca E0014. Nessa camada o número fica retido até
-- alguém consultar o Id da DPS; nas outras duas ele volta a valer.
ALTER TABLE "ServiceInvoice"
  ADD CONSTRAINT "chk_service_invoice_falha_camada"
  CHECK ("falhaCamada" IS NULL OR "falhaCamada" IN ('NOSSA', 'TRANSPORTE', 'RECEITA'));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) A IDENTIDADE DA NOTA — o índice único que faltava
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `ServiceInvoice` não tinha NENHUM `@@unique`. Como a numeração era read-modify-write fora de
-- transação (`String(Number(company.rpsNumero) + 1)` num `update` separado), duas emissões
-- simultâneas montavam o mesmo `nDPS` e o mesmo `Id` de DPS — e o banco aceitava as duas.
--
-- **POR QUE ESTAS TRÊS COLUNAS.** E0014 rejeita o conjunto *Série + Número + Código do Município
-- Emissor + CNPJ/CPF*. `"companyId"` responde pelos dois últimos: `"Company"."cnpj"` é UNIQUE (uma
-- empresa, um CNPJ) e o município emissor é `"Company"."codigoMunicipioIbge"` (uma empresa, um
-- `cLocEmi`). A tupla local é, portanto, a MESMA do E0014 — e nunca mais frouxa que ela.
--
-- **POR QUE NÃO `idDps`**, que codifica exatamente essa tupla: ele é string DERIVADA e é escrito
-- também pelo caminho de CAPTURA (`upsertFromProvider`), a partir do que o provedor devolve. Um
-- índice ali obrigaria dado de terceiro a obedecer à nossa regra de derivação. A tupla é o fato;
-- `idDps` é a codificação dele.
--
-- ⚠ Linhas capturadas têm `rpsSerie`/`rpsNumero` NULOS e **não colidem entre si**: no Postgres
-- NULL nunca é igual a NULL num índice único. A restrição alcança exatamente a numeração que nós
-- emitimos — que é a que precisa dela.
--
-- ⚠ SE ESTE COMANDO FALHAR, há linhas duplicadas e elas têm de ser olhadas ANTES, não contornadas.
-- Medir sem escrever nada (só leitura, zero chamada externa):
--   node apps/api/scripts/diag-nfse-numeracao.mjs
CREATE UNIQUE INDEX "ServiceInvoice_companyId_rpsSerie_rpsNumero_key"
  ON "ServiceInvoice" ("companyId", "rpsSerie", "rpsNumero");
