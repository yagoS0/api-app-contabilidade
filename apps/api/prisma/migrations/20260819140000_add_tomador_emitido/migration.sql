-- MEMÓRIA DO TOMADOR PARA QUEM A EMPRESA JÁ EMITIU — alimentada pela própria emissão.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- PEDIDO DO DONO (19/08/2026): *"ao emitir a nota para um tomador vamos salvar as informações; na
-- hora de emitir o cliente pode escolher o tomador ao qual ele já emitiu."*
--
-- ⚠ ISTO NÃO É UM CADASTRO DE CLIENTES. Não há tela de gestão, rota de edição nem exclusão — e as
-- três ausências são decisão, não pendência. Ver o comentário do model `TomadorEmitido` no
-- `schema.prisma`, onde o porquê está por extenso.
--
-- O QUE FOI MEDIDO ANTES (19/08/2026):
--   • nenhum model de tomador/cliente/destinatário existia neste schema;
--   • `ServiceInvoice` guarda do tomador **só** `tomadorDoc` e `tomadorNome` (`schema.prisma`,
--     linhas 347-348) — sem e-mail, sem endereço. É por isso que o reaproveitamento de nota não
--     traz o endereço hoje, e está escrito assim em
--     `apps/portal-cliente-web/src/features/emitir/lib/reaproveitarNota.js`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠ NOMES DE TABELA CONFERIDOS CONTRA AS MIGRATIONS EXISTENTES, NUNCA CONTRA O `schema.prisma`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
--   `tomadores_emitidos`  tabela NOVA, criada aqui. É o `@@map` do model `TomadorEmitido`, no
--                         mesmo estilo snake_case/plural das tabelas recentes (`contatos_whatsapp`,
--                         `envios_guia`, `atos_parcelamento`).
--   `"Company"`           model SEM `@@map`. Confirmado em migrations já aplicadas:
--                         `CREATE TABLE "Company"` na `20251204195725_init`, e
--                         `ALTER TABLE "Company"` na `20260814120000_add_nfse_emissao_fase1` e na
--                         `20260816120000_add_codigos_servico_nacional`.
--
-- ⚠ É o `REFERENCES "portal_clients"` (nome tirado do model, não da migration) que derrubou a
--   produção com P3009. `npm test`, `npm run build` e `prisma validate` NÃO executam SQL de
--   migration e não pegariam um nome errado aqui.
--
-- ⚠ `ON DELETE CASCADE`: a memória é DA empresa e não existe fora dela. Apagada a empresa, o
--   registro do tomador não tem mais a quem pertencer — é a mesma regra que `ServiceInvoice` e
--   `Partner` já usam contra `"Company"`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ O `schema.prisma` FOI EDITADO JUNTO — e por que aqui isso NÃO tem o risco da `Guide`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Há dois precedentes opostos e recentes:
--
--   • `20260818200000_add_linha_digitavel_guia` **não** editou o schema, porque a `"Guide"` é lida
--     sem `select` em várias rotas: um campo no model que não existe no banco derrubaria TODA
--     consulta de guia até a migration ser aplicada.
--   • `20260818210000_add_carga_tributaria_nao_simples` **editou**, porque sem o campo no model o
--     cadastro que o pedido criava não funcionava de jeito nenhum — não havia a variante "código
--     pronto esperando a migration".
--
-- Aqui o schema vai junto, e o risco da `Guide` **não existe neste caso** — a diferença é de
-- espécie, não de grau:
--
--   1. A `Guide` e a `"Company"` são tabelas VELHAS, lidas por rotas que já estão em produção.
--      Acrescentar um campo a um model existente muda o `SELECT` que o Prisma monta para consultas
--      que JÁ RODAM. Aqui não se acrescenta campo a model nenhum: cria-se um model NOVO, cuja
--      tabela é nova e que **nenhuma consulta existente lê**. O `SELECT` de `Company`,
--      `ServiceInvoice` e de todo o resto sai byte a byte igual ao de hoje.
--   2. A única coisa que o schema ganha do lado de `Company` é o campo de RELAÇÃO
--      `tomadoresEmitidos TomadorEmitido[]` — virtual, sem coluna, e que o Prisma só materializa
--      em `include`/`select` explícito. Ninguém o inclui.
--   3. E, como no caso da carga tributária, não há meio-termo: `prisma.tomadorEmitido` só existe
--      se o model existir. Sem ele, o módulo `application/nfse/tomadorEmitido.js` não é "código
--      pronto esperando" — é `undefined.upsert()`.
--
-- ⚠ ENTRE ESTA MIGRATION SER MERGEADA E SER APLICADA, o caminho de gravação encontra a tabela
--   inexistente (P2021). Isso é INOFENSIVO **por construção**: `registrarTomadorEmitido` nunca
--   lança, e a chamada em `NfseService.issue` ainda tem um `try/catch` próprio por cima. A nota
--   continua sendo emitida e gravada exatamente como hoje; o que não acontece é a memória. Há
--   teste sobre isso.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ADITIVA. Não remove coluna, não remove tabela, não altera tabela existente, não faz backfill.
-- Não há o que backfillar: `ServiceInvoice` não guarda endereço nem e-mail do tomador, então
-- reconstruir a memória a partir das notas antigas produziria registros pela metade — e um
-- endereço em branco que se apresenta como "o que já foi emitido" é pior que a ausência do
-- registro. A memória começa vazia e se enche com a próxima emissão.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "tomadores_emitidos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    -- CPF (11) ou CNPJ (14), só dígitos — a forma que `onlyDigits` já entrega no validador.
    "documento" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    -- Os seis campos de endereço com os nomes da DPS. Todos nullable: o validador só entrega o
    -- bloco quando os CINCO exigidos vêm juntos, então ou chegam todos ou não chega nenhum.
    "cMun" TEXT,
    "cep" TEXT,
    "xLgr" TEXT,
    "nro" TEXT,
    "xCpl" TEXT,
    "xBairro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Sobe em TODA emissão bem-sucedida, mudando o dado ou não.
    "ultimaEmissaoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Sobe SÓ quando algum campo mudou. NULL = nunca mudou desde que nasceu.
    "dadosAtualizadosEm" TIMESTAMP(3),

    CONSTRAINT "tomadores_emitidos_pkey" PRIMARY KEY ("id")
);

-- ⚠ A CHAVE DO PEDIDO: o documento DENTRO do escopo da empresa. `documento` sozinho seria global e
-- faria a emissão de uma empresa reescrever a memória de outra — num portal multi-empresa isso é o
-- dado de um cliente vazando para outro. É esta constraint que faz "emitiu de novo com dados
-- diferentes ⇒ ATUALIZA" em vez de acumular duplicatas.
--
-- ⚠ Não há índice separado por `companyId`: ele é a coluna LÍDER deste índice único, que o Postgres
-- já usa para varrer "os tomadores desta empresa".
CREATE UNIQUE INDEX "tomadores_emitidos_companyId_documento_key" ON "tomadores_emitidos"("companyId", "documento");

ALTER TABLE "tomadores_emitidos"
  ADD CONSTRAINT "tomadores_emitidos_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
