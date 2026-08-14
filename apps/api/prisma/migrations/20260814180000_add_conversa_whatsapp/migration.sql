-- WHATSAPP — A CONVERSA: o fio, as mensagens e o cadastro dos templates.
--
-- ⚠ NÃO APLICADA. Escrita e parada: não há banco alcançável nesta máquina, e `migrate deploy` é ato
--   do dono. Duas outras já esperam na fila (`20260814120000_add_nfse_emissao_fase1` e
--   `20260814160000_add_contato_whatsapp_usuario`).
--
-- ⚠ PRISMA, NUNCA `psql -f`. O `start:prod` roda `prisma migrate deploy`; tabela criada por fora
--   não entra em `_prisma_migrations`, o schema fica à deriva e o Prisma Client não enxerga o
--   model. O esqueleto do dono trazia `migrations/001_whatsapp.sql` para rodar no `psql` — esta é
--   a mesma intenção, escrita na convenção daqui.
--
-- ⚠ NOMES DE TABELA CONFERIDOS CONTRA AS MIGRATIONS EXISTENTES, NUNCA CONTRA O `schema.prisma`,
--   que nomeia MODELS:
--     grep -rhoE 'REFERENCES "[A-Za-z_]+"' apps/api/prisma/migrations/ | sort -u
--   As duas tabelas referenciadas aqui:
--     `"PortalClient"`  — model SEM `@@map`; a tabela é `"PortalClient"`. Foi
--                         `REFERENCES "portal_clients"` que derrubou a produção (P3009, migration
--                         marcada como falha, todas as seguintes recusadas, servidor sem subir).
--     `envios_guia`     — do `@@map` do model `EnvioGuia`, criada em
--                         20260805120000_add_whatsapp_contato_envio_guia.
--   `npm test`, `npm run build` e `prisma validate` NÃO executam SQL de migration: um nome errado
--   aqui passaria em tudo e só apareceria no deploy.
--
-- ⚠ ADITIVA. Nenhuma coluna alterada, nenhuma tabela existente tocada. `contatos_whatsapp` e
--   `envios_guia` NÃO são recriados: o esqueleto os trazia como `contato_whatsapp` e
--   `evento_envio_guia`, e criá-los daria duas listas de contato e dois estados de envio
--   divergindo no primeiro cadastro.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) O FIO — CHAVEADO PELO NÚMERO, NÃO PELO CONTATO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- O esqueleto tinha `conversa.contato_id` com `UNIQUE (contato_id)`. Isso não representa o caso que
-- `vinculoTelefone.js` já sabe responder: o MESMO número fala legitimamente por mais de uma empresa
-- (o sócio com três CNPJs), e `contatos_whatsapp` permite o mesmo telefone em várias empresas de
-- propósito (unique é `(portalClientId, telefoneE164)`). Chaveando pelo contato, uma mensagem
-- recebida de número ambíguo teria de ser gravada N vezes — a mesma frase do cliente no histórico
-- de N empresas. Isso não é redundância: é vazamento entre tenants.
--
-- Chaveando pelo NÚMERO: um fio, uma linha, e a empresa é uma ATRIBUIÇÃO separada, que pode ser
-- nula. Nulo = fila "não vinculados" — e nulo nunca casa com um `where` de escopo, então a fila não
-- pode aparecer dentro de empresa nenhuma.
CREATE TABLE "conversas_whatsapp" (
    "id" TEXT NOT NULL,
    "telefoneE164" TEXT NOT NULL,
    -- ⚠ O TENANT MORA AQUI. No esqueleto a mensagem só alcançava a empresa através do contato.
    -- NULO É RESPOSTA (`DESCONHECIDO` ou `AMBIGUO`), nunca "ainda não preenchi": o fio existe, a
    -- mensagem está guardada, e o que não acontece é escolher uma empresa em silêncio.
    "portalClientId" TEXT,
    -- `contacts[].profile.name` da Meta, registrado COMO OBSERVADO.
    -- ⚠ Nunca usado para casar empresa — casar por nome é a adivinhação proibida.
    "nomePerfilProvedor" TEXT,
    -- ⚠ INSTANTE, não contador `nao_lidas`. Contador tem dois escritores (webhook incrementa, tela
    -- zera) e diverge no primeiro evento reentregue, sem nada denunciar. Não lidas = mensagens
    -- recebidas depois deste instante.
    "lidaAteEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversas_whatsapp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversas_whatsapp_telefoneE164_key" ON "conversas_whatsapp"("telefoneE164");
CREATE INDEX "conversas_whatsapp_portalClientId_idx" ON "conversas_whatsapp"("portalClientId");

-- ⚠ SET NULL, não CASCADE: apagar a empresa DESATRIBUI o fio (que volta para a fila de não
-- vinculados); não apaga o que o cliente escreveu.
ALTER TABLE "conversas_whatsapp"
  ADD CONSTRAINT "conversas_whatsapp_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) A MENSAGEM — E A IDEMPOTÊNCIA DO WEBHOOK COMO GARANTIA DE BANCO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ A MENSAGEM NÃO TEM COLUNA DE STATUS, e isso é a fronteira com `envios_guia`.
--   `envios_guia`        = o estado do ENVIO DE UMA GUIA (uma linha por guia × canal). Já tem a
--                          escada pendente→enviando→enviado→entregue→lido|falhou, o retry, o erro
--                          traduzido e `aplicarStatusDoProvedor`, que NUNCA rebaixa.
--   `mensagens_whatsapp` = a CONVERSA: o que foi dito, por quem, quando.
--   O esqueleto guardava `mensagem.status` E `evento_envio_guia`, com um TODO para atualizar a guia
--   a partir do status da mensagem — duas respostas para "esta guia foi enviada?". Aqui a ligação é
--   o ponteiro `envioGuiaId`, e o estado tem um dono só.
CREATE TABLE "mensagens_whatsapp" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    -- O `id` do objeto de mensagem da Meta (`wamid.…`).
    "providerMessageId" TEXT,
    -- O valor do campo `type` da Meta, COPIADO como veio. Não se traduz para vocabulário nosso:
    -- seria inventar um de-para sem nunca ter visto um payload real.
    "tipo" TEXT NOT NULL,
    "corpo" TEXT,
    -- ⚠ O ID DA MÍDIA, NUNCA A URL: a URL que a Meta devolve EXPIRA. Baixar para o storage próprio
    -- é da fase do webhook; sem o id registrado, a mídia fica irrecuperável.
    "midiaProvedorId" TEXT,
    -- O ponto de encontro com `envios_guia` (ver acima).
    "envioGuiaId" TEXT,
    -- Instante reportado pela Meta (campo `timestamp` do evento), já convertido.
    "ocorridaEmProvedor" TIMESTAMP(3),
    -- Instante em que NÓS gravamos. Sempre POSTERIOR ao fato.
    "registradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_whatsapp_pkey" PRIMARY KEY ("id")
);

-- ⚠ ESTA É A IDEMPOTÊNCIA DO WEBHOOK, E ELA É DO BANCO. A Meta reentrega evento; com este índice a
-- segunda entrega do mesmo evento NÃO CONSEGUE virar uma segunda mensagem, não importa o que o
-- código faça. Mesmo desenho de `uq_baixa_guia_linha` e da reserva atômica de
-- `application/accounting/`. O que fica por conta do FLUXO é só reagir ao 23505/P2002 como
-- "já processado" em vez de erro — a garantia não depende disso.
CREATE UNIQUE INDEX "mensagens_whatsapp_providerMessageId_key" ON "mensagens_whatsapp"("providerMessageId");

CREATE INDEX "mensagens_whatsapp_conversaId_direcao_registradaEm_idx"
  ON "mensagens_whatsapp"("conversaId", "direcao", "registradaEm");
CREATE INDEX "mensagens_whatsapp_envioGuiaId_idx" ON "mensagens_whatsapp"("envioGuiaId");

ALTER TABLE "mensagens_whatsapp"
  ADD CONSTRAINT "mensagens_whatsapp_conversaId_fkey"
  FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: apagar a guia (hard-delete existe) leva o envio junto por CASCADE, mas não pode apagar
-- a mensagem que o cliente recebeu — o balão continua no fio, sem o ponteiro.
ALTER TABLE "mensagens_whatsapp"
  ADD CONSTRAINT "mensagens_whatsapp_envioGuiaId_fkey"
  FOREIGN KEY ("envioGuiaId") REFERENCES "envios_guia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mensagens_whatsapp"
  ADD CONSTRAINT "chk_mensagem_whatsapp_direcao" CHECK ("direcao" IN ('in', 'out'));

-- ⚠ SEM ESTE CHECK A IDEMPOTÊNCIA TEM UM BURACO COM FORMA DE NULL. Um índice único não impede
-- vários NULLs: mensagem recebida sem `providerMessageId` seria duplicável a cada reentrega. Mensagem
-- NOSSA pode nascer sem id (ele só volta na resposta da Meta); mensagem do cliente, não.
ALTER TABLE "mensagens_whatsapp"
  ADD CONSTRAINT "chk_mensagem_whatsapp_wamid_entrada"
  CHECK ("direcao" <> 'in' OR "providerMessageId" IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) OS TEMPLATES — DECLARADOS, NÃO APROVADOS
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ O esqueleto semeava os cinco com `status_aprovacao` default `'em_analise'`. Isso afirmaria uma
-- submissão que ninguém fez: o cadastro na Meta está PARADO à espera do número, e nenhum template
-- foi enviado para análise. `DECLARADO` = "consta do nosso plano e NUNCA foi conferido na Meta" —
-- a mesma marca de `verificadoTrial: false` e `verificadoNoLeiaute: false`.
-- ⚠ E `nomeMeta` NASCE NULO pelo mesmo motivo: o nome EXATO só existe depois da aprovação. Copiar a
-- chave para lá transformaria a nossa intenção em cadastro do provedor.
CREATE TABLE "templates_whatsapp" (
    "chave" TEXT NOT NULL,
    "nomeMeta" TEXT,
    "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "categoria" TEXT NOT NULL DEFAULT 'UTILITY',
    -- Header de documento: é o que permite anexar o PDF da guia (manual do dono, Etapa 6).
    "temDocumento" BOOLEAN NOT NULL DEFAULT false,
    "statusAprovacao" TEXT NOT NULL DEFAULT 'DECLARADO',
    "motivoRejeicao" TEXT,
    -- Nulo = o estado nunca foi lido da Meta. É o que separa dado nosso de dado dela.
    "conferidoNaMetaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_whatsapp_pkey" PRIMARY KEY ("chave")
);

ALTER TABLE "templates_whatsapp"
  ADD CONSTRAINT "chk_template_whatsapp_status"
  CHECK ("statusAprovacao" IN ('DECLARADO', 'EM_ANALISE', 'APROVADO', 'REJEITADO'));

-- As cinco chaves do plano do dono. Categoria e idioma são decisão dele (Utility, pt_BR);
-- `temDocumento` só no `guia_disponivel`, que é o que carrega o PDF da guia.
INSERT INTO "templates_whatsapp" ("chave", "temDocumento", "updatedAt") VALUES
  ('guia_disponivel',      true,  CURRENT_TIMESTAMP),
  ('solicitar_documentos', false, CURRENT_TIMESTAMP),
  ('lembrete_vencimento',  false, CURRENT_TIMESTAMP),
  ('sem_movimento',        false, CURRENT_TIMESTAMP),
  ('reabrir_conversa',     false, CURRENT_TIMESTAMP);
