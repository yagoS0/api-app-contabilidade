-- PERFIL DE EMISSÃO DE NFS-e — o contador configura uma vez; o cliente deixa de responder por nota.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ ESTA MIGRATION É INERTE POR CONSTRUÇÃO: cria UMA tabela nova, sem tocar em coluna existente,
-- sem backfill e sem FK em nada além do `PortalClient`. Nenhuma consulta atual a lê. Com a flag
-- `INTEGRACAO_PERFIL_EMISSAO_NFSE` desligada — que é como ela nasce — o gerador do XML não a
-- consulta; quem a consulta é a TELA do contador, para mostrar o que a próxima DPS vai levar.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE UMA TABELA, E NÃO MAIS COLUNAS NA `Company`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- A configuração de emissão vive hoje em ~10 colunas da `Company`, e elas comportam UMA resposta
-- por empresa. Isso não cabe nos casos reais da carteira, trazidos pelo dono em 01/09/2026:
--
--   • empresa de OBRA, que tem CNO e emite também consultoria;
--   • empresa que presta serviço PARA O EXTERIOR, e também no Brasil.
--
-- São operações com tributação diferente na MESMA empresa. Com uma resposta só, o cliente teria de
-- corrigir a nota à mão a cada emissão — que é exatamente o problema que este trabalho existe para
-- acabar.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ POR QUE COLUNA TIPADA, E NUNCA UM `Json`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `CadastroFiscal.perfilAtividades` é `Json?` sem schema, e o resultado está medido: de 8 campos,
-- **3 não têm um único leitor** (`codigoServicoMunicipal`, `retencaoFonte`, `domicilioFiscal`) e o
-- terceiro **nem input tem** — só faz round-trip. A tela chega a rotulá-los "⚠ ainda sem uso".
-- JSON sem schema não tem constraint, não tem índice e não tem quem denuncie o campo morto.
--
-- Aqui o domínio de cada campo é uma enumeração do XSD oficial (`TSRegEspTrib`, `TSTribISSQN`,
-- `TSRegimeApuracaoSimpNac`), então ele cabe em coluna — e cabe em CHECK.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ SEIS CAMPOS FISCAIS, E NÃO OS TRINTA DO LEIAUTE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Regra desta entrega: **coluna só nasce com o código que a lê, no mesmo commit**. Os seis abaixo
-- são exatamente os que `buildDpsXml` JÁ escreve hoje — logo o resolvedor tem o que resolver e o
-- painel tem contra o que comparar. Dois deles estão CRAVADOS no gerador e são defeito conhecido:
--
--   `regApTribSN` .. `NfseService.js:826` escreve "1" para todo optante, e
--                    `CadastroFiscal.sublimiteICMSISS` é o cadastro do caso 2. Empresa do Simples
--                    acima do sublimite declara hoje o regime de apuração ERRADO.
--   `tribISSQN` .... `NfseService.js:887` escreve "1" sempre — por isso exportação de serviço
--                    (valor 3) é impossível de declarar.
--
-- `pAliq`, `BM`, `exigSusp`, `tpImunidade`, `comExt` e `obra` entram na fase em que o gerador
-- passar a montá-los — e aí com o de-para da versão do leiaute em mãos, porque `TCTribMunicipal`
-- **reordenou os filhos** entre 1.00 e 1.01.
--
-- ⚠ NENHUM DEFAULT NOS CAMPOS FISCAIS. NULL = "o contador não respondeu", nunca "não". É a lição de
-- `CadastroFiscal.usaFatorR` (`DEFAULT false`, que não distingue "disse que não" de "nunca abriu a
-- tela"). Só `ativo`, `padrao`, `origem` e os dois `habilita_*` têm default — são identidade e
-- forma, não afirmam nada sobre tributo.

CREATE TABLE "perfis_emissao_nfse" (
    "id"                        TEXT         NOT NULL,
    "portalClientId"            TEXT         NOT NULL,

    "nome"                      TEXT         NOT NULL,
    "ativo"                     BOOLEAN      NOT NULL DEFAULT true,
    "padrao"                    BOOLEAN      NOT NULL DEFAULT false,
    "origem"                    TEXT         NOT NULL DEFAULT 'DERIVADO_DO_CADASTRO',

    -- serviço
    "codigoServicoNacional"     TEXT         NOT NULL,
    "codigoServicoMunicipal"    TEXT,
    "cLocPrestacao"             TEXT,

    -- regime na DPS (prest/regTrib)
    "regEspTrib"                TEXT,
    "regApTribSN"               TEXT,

    -- ISSQN (trib/tribMun)
    "tribISSQN"                 TEXT,

    -- o perfil HABILITA; o cliente informa o fato daquela nota
    "habilitaObra"              BOOLEAN      NOT NULL DEFAULT false,
    "habilitaExportacao"        BOOLEAN      NOT NULL DEFAULT false,

    "createdByUserId"           TEXT,
    "criadoEm"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfis_emissao_nfse_pkey" PRIMARY KEY ("id")
);

-- ⚠ O nome é a identidade que o CLIENTE vê no seletor. Dois homônimos na mesma empresa ofereceriam
-- a mesma coisa duas vezes, com efeitos fiscais diferentes.
CREATE UNIQUE INDEX "perfis_emissao_nfse_portalClientId_nome_key"
    ON "perfis_emissao_nfse"("portalClientId", "nome");

CREATE INDEX "perfis_emissao_nfse_portalClientId_ativo_idx"
    ON "perfis_emissao_nfse"("portalClientId", "ativo");

-- ⚠⚠ A TABELA É `"PortalClient"`, NÃO `portal_clients`. O model não tem `@@map`, e o `schema.prisma`
-- nomeia MODELS, não tabelas. `REFERENCES "portal_clients"` **derrubou a produção** — está escrito
-- em `20260813120000_add_procedencia_das` e repetido em `20260814160000_add_contato_whatsapp_usuario`.
-- Esta migration escreveu o nome errado na primeira versão; o aviso das anteriores é que o pegou.
-- ⚠ `npm test`, `npm run build` e `prisma validate` **não executam SQL de migration** e não
-- pegariam isto. Confira nome de tabela contra as migrations JÁ APLICADAS, nunca contra o schema.
ALTER TABLE "perfis_emissao_nfse"
    ADD CONSTRAINT "perfis_emissao_nfse_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- OS CHECKS — a forma do XSD, no banco
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ Aqui o CHECK É POSSÍVEL, ao contrário do `codigosServicoNacional` (`TEXT[]`): conferir cada
-- elemento de um array exige `unnest`, que é subquery, e o Postgres a proíbe em CHECK. Coluna
-- escalar não tem esse problema — e migration que falha é P3009 e servidor que não sobe.
--
-- ⚠ Todos aceitam NULL, porque NULL é "não respondido" e é um estado legítimo.

-- `cTribNac`: 6 dígitos, sem padding. Fabricar código a partir de um dígito a menos é a classe do
-- `cLocEmi="0000000"`.
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_ctribnac_check"
    CHECK ("codigoServicoNacional" ~ '^[0-9]{6}$');

-- ⚠⚠ `cTribMun`: EXATAMENTE 3 dígitos. O gerador faz `.slice(-3)`, que ENCURTA o longo e **não
-- completa o curto** — um "12" gravado sairia como `12` no XML e a nota seria recusada. Medido em
-- produção: 31 de 34 empresas com o campo vazio; as 3 preenchidas são todas `001`.
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_ctribmun_check"
    CHECK ("codigoServicoMunicipal" IS NULL OR "codigoServicoMunicipal" ~ '^[0-9]{3}$');

-- `cLocPrestacao`: código do IBGE, 7 dígitos.
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_clocprestacao_check"
    CHECK ("cLocPrestacao" IS NULL OR "cLocPrestacao" ~ '^[0-9]{7}$');

-- `TSRegEspTrib` — tiposSimples_v1.00.xsd: 0..6 e 9 (o 7 e o 8 NÃO existem).
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_regesptrib_check"
    CHECK ("regEspTrib" IS NULL OR "regEspTrib" IN ('0','1','2','3','4','5','6','9'));

-- `TSRegimeApuracaoSimpNac` — 1, 2 ou 3. Só se aplica a `opSimpNac = 3`.
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_regaptribsn_check"
    CHECK ("regApTribSN" IS NULL OR "regApTribSN" IN ('1','2','3'));

-- `TSTribISSQN` — 1 tributável, 2 imunidade, 3 exportação, 4 não incidência.
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_tribissqn_check"
    CHECK ("tribISSQN" IS NULL OR "tribISSQN" IN ('1','2','3','4'));

-- Vocabulário fechado da procedência do perfil.
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_origem_check"
    CHECK ("origem" IN ('DERIVADO_DO_CADASTRO','MANUAL'));

-- ⚠ SEM backfill. Nenhum dado do banco prova que o contador quis um perfil para alguma empresa, e
-- materializar 34 perfis "derivados" criaria configuração que ninguém afirmou. Quem materializa é
-- a leitura, sob demanda (`garantirPerfilPadrao`), com `origem = 'DERIVADO_DO_CADASTRO'` à vista.
