-- IMPORTAÇÃO DE EXTRATO OFX PELO CLIENTE — o registro de "quem subiu o quê, e o que aconteceu".
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ ADITIVA E INERTE: UMA tabela nova, uma FK. Nenhuma coluna existente é tocada, nenhum dado é
--   alterado, nenhum índice existente é mexido.
--
-- ⚠ MIGRATION SEPARADA, e não uma edição da `20260824120000_add_conferencia_lancamentos`. Aquela
--   não foi aplicada ainda, mas editar migration é uma janela de corrida: basta o dono aplicá-la
--   entre a leitura e a escrita para o histórico ficar inconsistente. A convenção desta casa é
--   explícita — *"nunca editar arquivos de migration já aplicados"* — e o custo de um arquivo a
--   mais é zero.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- POR QUE ESTA TABELA EXISTE — e o que ela NÃO é
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- Pergunta do dono (24/08/2026): *"temos alguma proteção caso o cliente queira importar vários,
-- sendo mesmo?"*
--
-- ⚠⚠ **ELA NÃO É A PROTEÇÃO.** A proteção contra duplicata vive no
-- `@@unique(portalClientId, hashDedupe)` de `lancamentos_declarados`, e age **transação a
-- transação** — porque a **sobreposição de períodos é o caso NORMAL**: o cliente baixa 01–31/jan e
-- depois 15/jan–15/fev, que é o comportamento esperado de quem usa internet banking. Recusar
-- "arquivo repetido" barraria o fluxo certo e deixaria passar o errado.
--
-- Esta tabela existe por dois motivos, os dois pequenos e os dois reais:
--
--   1. permitir a frase *"este arquivo você já subiu em 12/08"* — o `hashArquivo` responde isso, e
--      **sem** ele o sistema só saberia dizer "0 novas", que é a mesma resposta de um extrato de um
--      período que já estava todo importado;
--   2. dar escritor a `lancamentos_declarados.ofxImportId`. Coluna que ninguém escreve é a guarda
--      morta que este projeto já pagou uma vez (`hasAccountingDivergence`: um escritor, zero
--      leitores, meses no ar).
--
-- ⚠ `hashArquivo` NÃO É UNIQUE, de propósito. O mesmo arquivo pode voltar legitimamente depois de
--   linhas terem sido recusadas, ou depois de o contador consertar o plano de contas. Ele é índice
--   de BUSCA, não trava.

CREATE TABLE "ofx_imports" (
    "id"              TEXT NOT NULL,
    "portalClientId"  TEXT NOT NULL,

    "hashArquivo"     TEXT NOT NULL,
    "nomeArquivo"     TEXT,
    -- ⚠ `ACCTID` do `<BANKACCTFROM>`. NULO quando o arquivo não o traz — e aí o dedupe fica mais
    --   FROUXO (por empresa, sem separar contas). A tela precisa dizer isso, não fingir que sabe.
    "contaBancaria"   TEXT,
    "bancoId"         TEXT,

    -- ⚠ O relatório congelado. NADA SOME: descartadas e fora-do-escopo são CONTADAS, senão
    --   "não veio nada" e "deu erro" ficam iguais na tela.
    "transacoesLidas" INTEGER NOT NULL,
    "criados"         INTEGER NOT NULL,
    "jaImportadas"    INTEGER NOT NULL,
    "descartadas"     INTEGER NOT NULL,
    -- ⚠ Créditos. Esta fila é de DESPESA — a forma do lançamento de ENTRADA não foi medida, e criar
    --   item de fila que ninguém consegue resolver é beco sem saída.
    "foraDoEscopo"    INTEGER NOT NULL,
    "detalhe"         JSONB,

    "criadoPor"       TEXT NOT NULL,
    "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofx_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ofx_imports_portalClientId_criadoEm_idx"
    ON "ofx_imports"("portalClientId", "criadoEm");
-- Serve à pergunta "este arquivo já passou por aqui?" — ⚠ busca, nunca unicidade.
CREATE INDEX "ofx_imports_portalClientId_hashArquivo_idx"
    ON "ofx_imports"("portalClientId", "hashArquivo");

ALTER TABLE "ofx_imports"
    ADD CONSTRAINT "ofx_imports_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠ NÃO há FK de `lancamentos_declarados.ofxImportId` para cá, e é a mesma decisão de
--   `accountingEntryId`: apagar o registro de uma importação não pode apagar nem desvincular a
--   despesa que ela criou. O id fica, e a varredura o denuncia se apontar para nada.
