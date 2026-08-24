-- CONFERÊNCIA DE LANÇAMENTOS — a nota vira despesa, o extrato vira o pagamento dela.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ ADITIVA E INERTE. Três tabelas NOVAS e duas FKs para tabelas existentes. Nenhuma coluna de
--   tabela existente é alterada, nenhum dado é tocado, nenhum índice existente é mexido. Nenhuma
--   consulta atual lê estas tabelas, então subir o código antes de aplicar não quebra nada — o que
--   não funciona é a fila, que ainda não tem tela. (É o oposto da
--   `20260818210000_add_carga_tributaria_nao_simples`, que mexia em `"Company"` e por isso exigia
--   ser aplicada ANTES.)
--
-- ⚠ NOMES DE TABELA CONFERIDOS CONTRA AS MIGRATIONS, nunca contra o `schema.prisma` (que nomeia
--   MODELS): `"PortalClient"` em `CREATE TABLE "PortalClient"` na `20251204195725_init`;
--   `"PortalInvoice"` idem. Os dois são PascalCase sem `@@map`, e as tabelas novas usam snake_case
--   com `@@map`, que é o padrão das tabelas recentes (`envios_guia`, `lotes_emissao_nfse`).
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- POR QUE `dataPagamento` É NULA, E POR QUE ISSO É O CORAÇÃO DO DESENHO
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- Medido em produção (`scripts/diag-forma-despesa.mjs`, 24/08/2026): **155 de 155** lançamentos
-- `tipo:"DESPESA"` desta casa são `1D / 1C` com o crédito na conta de **CAIXA** (reduzido 5,
-- `1.1.1.01.0001`). Ou seja, o lançamento de despesa aqui AFIRMA A SAÍDA DO DINHEIRO.
--
-- A nota recebida não sabe quando o dinheiro saiu. Lançá-la na data de emissão mentiria sobre o
-- caixa em toda despesa a prazo — e em silêncio. Por isso existe o estado
-- `AGUARDANDO_PAGAMENTO`: enquanto a data não for conhecida, essa é a resposta honesta.
--
-- ⚠ E ele NÃO é prisão (dono, 24/08/2026): o contador lança quando decidir, mesmo sem comprovante,
--   informando a data — que fica gravada em `origemPagamento` como DECLARAÇÃO, não como prova.
--
-- ⚠⚠ A REGRA NÃO MORA AQUI. Quem decide transição é
--    `src/application/declarados/lib/estadosDeclarado.js` (puro, 70 testes). O banco guarda os
--    cintos que sobrevivem a bug de aplicação: a unicidade do dedupe e o CHECK da âncora.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. LANCAMENTOS_DECLARADOS
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "lancamentos_declarados" (
    "id"                   TEXT NOT NULL,
    "portalClientId"       TEXT NOT NULL,
    "origem"               TEXT NOT NULL,
    "estado"               TEXT NOT NULL,
    "tipo"                 TEXT NOT NULL,
    "valor"                DECIMAL(18,2) NOT NULL,
    "competencia"          TEXT,

    "notaRecebidaId"       TEXT,
    "dataDocumento"        TIMESTAMP(3),
    "cnpjFornecedor"       TEXT,
    "descricaoOriginal"    TEXT NOT NULL,
    "descricaoNormalizada" TEXT NOT NULL,
    "detalheServico"       TEXT,

    "dataPagamento"        TIMESTAMP(3),
    "origemPagamento"      TEXT,
    "ofxImportId"          TEXT,
    "fitId"                TEXT,
    "contaBancariaRef"     TEXT,

    "hashDedupe"           TEXT NOT NULL,

    "guiaId"               TEXT,
    "parDeclaradoId"       TEXT,
    "accountingEntryId"    TEXT,
    "regraId"              TEXT,
    "contaSugerida"        TEXT,
    "contaAplicada"        TEXT,
    "valorAjustado"        DECIMAL(18,2),
    "motivoRecusa"         TEXT,

    "criadoPor"            TEXT NOT NULL,
    "decididoPor"          TEXT,
    "decididoEm"           TIMESTAMP(3),
    "criadoEm"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lancamentos_declarados_pkey" PRIMARY KEY ("id")
);

-- ⚠⚠ A IDEMPOTÊNCIA MORA NO BANCO, não só no código. A varredura de notas roda de novo a cada
--    captura; sem este índice, a segunda passada duplicaria a fila inteira — e "rodei duas vezes"
--    é o caso normal, não o excepcional.
CREATE UNIQUE INDEX "lancamentos_declarados_portalClientId_hashDedupe_key"
    ON "lancamentos_declarados"("portalClientId", "hashDedupe");

CREATE INDEX "lancamentos_declarados_portalClientId_estado_idx"
    ON "lancamentos_declarados"("portalClientId", "estado");
CREATE INDEX "lancamentos_declarados_portalClientId_competencia_idx"
    ON "lancamentos_declarados"("portalClientId", "competencia");
-- Serve a âncora FORTE do aprendizado (empresa × CNPJ do fornecedor).
CREATE INDEX "lancamentos_declarados_portalClientId_cnpjFornecedor_idx"
    ON "lancamentos_declarados"("portalClientId", "cnpjFornecedor");
CREATE INDEX "lancamentos_declarados_notaRecebidaId_idx"
    ON "lancamentos_declarados"("notaRecebidaId");

ALTER TABLE "lancamentos_declarados"
    ADD CONSTRAINT "lancamentos_declarados_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠ `SET NULL` e não `CASCADE`: apagar a nota não pode apagar a despesa. O `cnpjFornecedor`, o
--   valor e a descrição já estão denormalizados nesta linha, então o registro sobrevive inteiro ao
--   sumiço do documento — perde-se o link, não o fato.
ALTER TABLE "lancamentos_declarados"
    ADD CONSTRAINT "lancamentos_declarados_notaRecebidaId_fkey"
    FOREIGN KEY ("notaRecebidaId") REFERENCES "PortalInvoice"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ⚠⚠ `accountingEntryId` FICA SEM FK, DE PROPÓSITO — mesmo desenho de
--    `AccountingEntry.estornoDeEntryId` (`20260808150000_add_estorno_baixa`). Com `SET NULL`, um
--    lançamento apagado por fora deixaria a linha em `CONTABILIZADO` apontando para nada e o
--    apagamento da evidência seria SILENCIOSO; com `RESTRICT`, o `DELETE /entries/:id` que o
--    contador já usa hoje passaria a devolver 500. Sem FK, o id permanece e a varredura o denuncia
--    nomeando o que houve.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. ANEXOS_DECLARADOS
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "anexos_declarados" (
    "id"           TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "url"          TEXT NOT NULL,
    "mimeType"     TEXT,
    "nomeArquivo"  TEXT,
    "criadoPor"    TEXT NOT NULL,
    "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexos_declarados_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "anexos_declarados_lancamentoId_idx" ON "anexos_declarados"("lancamentoId");

ALTER TABLE "anexos_declarados"
    ADD CONSTRAINT "anexos_declarados_lancamentoId_fkey"
    FOREIGN KEY ("lancamentoId") REFERENCES "lancamentos_declarados"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. REGRAS_CONTABILIZACAO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "regras_contabilizacao" (
    "id"              TEXT NOT NULL,
    "portalClientId"  TEXT NOT NULL,
    "cnpjFornecedor"  TEXT,
    "padraoDescricao" TEXT,
    "valorMin"        DECIMAL(18,2) NOT NULL,
    "valorMax"        DECIMAL(18,2) NOT NULL,
    "contaDestino"    TEXT NOT NULL,
    "tipo"            TEXT NOT NULL,
    "origemRegra"     TEXT NOT NULL,
    "ativa"           BOOLEAN NOT NULL DEFAULT true,
    "suspensaEm"      TIMESTAMP(3),
    "motivoSuspensao" TEXT,
    "criadaPor"       TEXT NOT NULL,
    "confirmacoesBase" JSONB,
    "criadaEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm"      TIMESTAMP(3),
    "aplicacoes"      INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "regras_contabilizacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "regras_contabilizacao_portalClientId_ativa_idx"
    ON "regras_contabilizacao"("portalClientId", "ativa");
CREATE INDEX "regras_contabilizacao_portalClientId_cnpjFornecedor_idx"
    ON "regras_contabilizacao"("portalClientId", "cnpjFornecedor");

ALTER TABLE "regras_contabilizacao"
    ADD CONSTRAINT "regras_contabilizacao_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠⚠ REGRA SEM ÂNCORA CASARIA COM TUDO, e uma regra assim contabilizaria a carteira inteira numa
--    conta só, automaticamente, sem ninguém ver. O Prisma não modela CHECK, então ele vive só aqui
--    — e é por isso que o `schema.prisma` traz o aviso apontando para esta linha.
ALTER TABLE "regras_contabilizacao"
    ADD CONSTRAINT "chk_regra_tem_ancora"
    CHECK ("cnpjFornecedor" IS NOT NULL OR "padraoDescricao" IS NOT NULL);

-- ⚠ A FAIXA DE VALOR É OBRIGATÓRIA e tem de ser coerente. Regra automática com faixa invertida
--   nunca casaria (defeito mudo); com faixa negativa casaria com estorno. É guarda barata.
ALTER TABLE "regras_contabilizacao"
    ADD CONSTRAINT "chk_regra_faixa_coerente"
    CHECK ("valorMin" >= 0 AND "valorMax" >= "valorMin");
