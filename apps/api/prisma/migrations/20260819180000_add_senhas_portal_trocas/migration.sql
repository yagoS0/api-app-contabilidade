-- QUEM TROCOU A SENHA DO PORTAL DAQUELE CLIENTE, E QUANDO.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- PEDIDO DO DONO (19/08/2026): *"o contador deve poder mudar a senha via cadastro da empresa, como
-- o cliente também pode via recuperação ou o próprio cadastro; mas quando mudar, o portal do
-- contador também muda."*
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ POR QUE UMA TABELA EXISTE, quando o pedido só falava em "trocar a senha"
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Porque isto é TRANSFERÊNCIA DE AUTORIDADE, não uma edição de cadastro. Quem define a senha do
-- usuário do portal pode entrar como ele e EMITIR NFS-e em nome da empresa dele
-- (`routes/middlewares/emissaoNfseGate.js` deixa passar `OWNER`/`CLIENT_ADMIN`). Sem registro, a
-- pergunta que se faz depois de um incidente — *"quem tinha o acesso quando aquela nota saiu?"* —
-- não tem resposta em lugar nenhum do banco. É o mesmo raciocínio, palavra por palavra, de
-- `company_credential_acessos` (20260812120000): ato de consequência ganha tabela própria,
-- append-only, com cópia imutável de quem agiu.
--
-- ⚠⚠ NADA DA SENHA ENTRA AQUI. Nem o texto claro, nem o hash, nem o tamanho, nem um prefixo.
-- A senha do portal é `bcrypt` em `"User"."passwordHash"` e NÃO TEM VOLTA — é assim de propósito, e
-- nenhuma coluna deste projeto pode passar a permitir lê-la. Uma cópia do banco não pode virar a
-- senha de todos os clientes de um portal onde eles emitem nota fiscal em nome da própria empresa.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE NÃO DUAS COLUNAS EM `"PortalClient"` (que seria mais barato)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Duas colunas (`senhaTrocadaEm`/`senhaTrocadaPor`) no molde de `emissaoClienteLiberadaEm/Por`
-- seriam POR EMPRESA — e a senha é DE UM USUÁRIO. Medido em produção (19/08/2026): 33 empresas,
-- 33 usuários `OWNER` ativos, um por empresa. Hoje os dois recortes coincidem; no dia em que uma
-- empresa tiver dois usuários do portal, a coluna passaria a responder "a senha de quem?" com o
-- último que trocou, misturando dois históricos numa linha só. É o defeito documentado em "TRÊS
-- NÚMEROS DE DAS, TRÊS COLUNAS", e ele é barato de evitar agora e caro de desfazer depois.
--
-- ⚠ A tabela também é o que faz o estado ser HONESTO nos TRÊS caminhos. A troca pela recuperação
-- de e-mail e a troca pelo próprio perfil do cliente (`POST /auth/change-password`) não passam por
-- empresa nenhuma — não teriam onde escrever numa coluna de `"PortalClient"`, e a tela do contador
-- diria "trocada por mim em tal dia" para uma senha que o cliente já trocou depois.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠ NOMES DE TABELA CONFERIDOS CONTRA AS MIGRATIONS, NUNCA CONTRA O `schema.prisma`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
--   `senhas_portal_trocas`  tabela NOVA, criada aqui. `@@map` do model `PortalPasswordChange`, no
--                           mesmo estilo snake_case/plural das tabelas recentes
--                           (`company_credential_acessos`, `password_reset_tokens`,
--                           `tomadores_emitidos`).
--   `"User"`                model SEM `@@map`. Confirmado em migration aplicada:
--                           `CREATE TABLE "User"` na `20251208202800_add_users`.
--   `"PortalClient"`        model SEM `@@map` — o nome da TABELA é `"PortalClient"`, NÃO
--                           `portal_clients`. Confirmado nas FKs já aplicadas da
--                           `20260812120000_add_company_credentials`
--                           (`REFERENCES "PortalClient"("id")`, linhas 48, 84 e 133).
--                           ⚠ Foi exatamente `REFERENCES "portal_clients"` que derrubou a produção
--                           com P3009 antes; por isso este parágrafo existe.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- AS DUAS REGRAS DE `ON DELETE`, e por que são DIFERENTES
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
--   `userId`         → CASCADE. A linha é sobre a senha DAQUELE usuário; sem o usuário ela não
--                      responde a pergunta nenhuma. Mesma escolha de `password_reset_tokens`.
--   `portalClientId` → SET NULL. O histórico da troca SOBREVIVE ao encerramento da empresa — é
--                      justamente depois de um cliente sair que se pergunta quem tinha o acesso.
--   `autorUserId`    → SEM FK, de propósito, exatamente como `usuarioId` em
--                      `company_credential_acessos`. Um contador desligado do escritório pode ser
--                      apagado, e a linha de auditoria não pode sumir nem virar órfã por isso —
--                      é para esse caso que `autorNome`/`autorEmail` são CÓPIA IMUTÁVEL, gravada
--                      no instante do ato e nunca mais lida da `"User"`.

CREATE TABLE IF NOT EXISTS "senhas_portal_trocas" (
  "id"             TEXT NOT NULL,
  -- De QUEM é a senha que foi trocada.
  "userId"         TEXT NOT NULL,
  -- Em qual empresa o contador estava quando trocou. NULO nos caminhos do cliente, que não passam
  -- por empresa nenhuma — e nulo NÃO significa "não sabemos", significa "não houve empresa".
  "portalClientId" TEXT,
  -- ESCRITORIO | CLIENTE_PERFIL | CLIENTE_RECUPERACAO (CHECK abaixo).
  "origem"         TEXT NOT NULL,
  -- Quem AGIU. Igual a "userId" nos dois caminhos do cliente; o contador nos do escritório.
  "autorUserId"    TEXT,
  -- Cópia imutável do autor — ver o parágrafo do `ON DELETE` acima.
  "autorNome"      TEXT,
  "autorEmail"     TEXT,
  "ip"             TEXT,
  "userAgent"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "senhas_portal_trocas_pkey" PRIMARY KEY ("id")
);

-- ⚠ O CHECK é a diferença entre três estados e "qualquer string". A tela do contador escolhe a
-- frase pelo `origem` ("por você", "pelo próprio cliente", "por recuperação de e-mail"); um valor
-- fora da lista não tem frase e cairia num rótulo genérico — que é exatamente a informação que a
-- tela existe para dar. Mesmo desenho do CHECK de `acao` em `company_credential_acessos`.
ALTER TABLE "senhas_portal_trocas"
  DROP CONSTRAINT IF EXISTS "senhas_portal_trocas_origem_check";
ALTER TABLE "senhas_portal_trocas"
  ADD CONSTRAINT "senhas_portal_trocas_origem_check"
  CHECK ("origem" IN ('ESCRITORIO', 'CLIENTE_PERFIL', 'CLIENTE_RECUPERACAO'));

-- A consulta da tela é "a ÚLTIMA troca deste usuário": `where userId in (…) order by createdAt desc`.
CREATE INDEX IF NOT EXISTS "senhas_portal_trocas_userId_createdAt_idx"
  ON "senhas_portal_trocas" ("userId", "createdAt" DESC);

-- A consulta de auditoria é "tudo o que aconteceu nesta empresa".
CREATE INDEX IF NOT EXISTS "senhas_portal_trocas_portalClientId_createdAt_idx"
  ON "senhas_portal_trocas" ("portalClientId", "createdAt" DESC);

ALTER TABLE "senhas_portal_trocas"
  DROP CONSTRAINT IF EXISTS "senhas_portal_trocas_userId_fkey";
ALTER TABLE "senhas_portal_trocas"
  ADD CONSTRAINT "senhas_portal_trocas_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "senhas_portal_trocas"
  DROP CONSTRAINT IF EXISTS "senhas_portal_trocas_portalClientId_fkey";
ALTER TABLE "senhas_portal_trocas"
  ADD CONSTRAINT "senhas_portal_trocas_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
