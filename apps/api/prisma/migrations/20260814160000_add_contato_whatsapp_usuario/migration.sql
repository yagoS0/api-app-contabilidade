-- QUEM é a pessoa por trás do número de WhatsApp.
--
-- ADITIVA E NULLABLE, SEM BACKFILL. Contato do financeiro terceirizado, do sócio sem login no
-- portal, ou cadastrado antes de a pessoa ter conta é caso NORMAL — nulo é a resposta honesta
-- ("não sei quem é"), e o vínculo devolve isso NOMEADO em vez de adivinhar por nome.
--
-- ⚠ NOMES DE TABELA CONFERIDOS CONTRA AS MIGRATIONS EXISTENTES, NUNCA CONTRA O `schema.prisma`,
--   que nomeia MODELS. `PortalClient` não tem `@@map` — a tabela é `"PortalClient"`, e foi
--   `REFERENCES "portal_clients"` que derrubou a produção. Aqui as duas tabelas são:
--     `contatos_whatsapp`  (do `@@map` do model `ContatoWhatsapp`, criada em
--                           20260805120000_add_whatsapp_contato_envio_guia)
--     `"User"`             (model sem `@@map`; confirmado por `REFERENCES "User"` em migrations
--                           já aplicadas)
--   `npm test`, `npm run build` e `prisma validate` NÃO executam SQL de migration e não pegariam
--   um nome errado aqui.
--
-- ⚠ `ON DELETE SET NULL`: apagar o usuário apaga a IDENTIFICAÇÃO da pessoa, nunca o contato da
--   empresa. CASCADE aqui faria a exclusão de um login levar junto o número pelo qual a empresa
--   fala com o escritório.

ALTER TABLE "contatos_whatsapp" ADD COLUMN "userId" TEXT;

CREATE INDEX "contatos_whatsapp_userId_idx" ON "contatos_whatsapp"("userId");

ALTER TABLE "contatos_whatsapp"
  ADD CONSTRAINT "contatos_whatsapp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
