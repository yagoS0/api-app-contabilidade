-- RECUPERAÇÃO DE SENHA — a tabela do token de redefinição.
--
-- ⚠ NÃO APLICADA. Escrita e parada; `prisma migrate deploy` é ato do dono.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- NOME DE TABELA — conferido, não suposto
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Nome de tabela se confere no que JÁ EXISTE nas migrations, com
--   grep -rhoE 'REFERENCES "[A-Za-z_]+"' apps/api/prisma/migrations/ | sort -u
-- NUNCA no `schema.prisma`, que fala em nomes de MODEL. Foi `REFERENCES "portal_clients"` —
-- quando a tabela é `"PortalClient"` — que fez o Prisma marcar a migration como falha, recusar
-- todas as seguintes com P3009 e impedir o servidor de subir.
--
-- Esta migration cria UMA FK, e o alvo dela é `"User"`. Conferido: `User` **não tem `@@map`**, e
-- `REFERENCES "User"("id")` aparece em DDL REAL (não em comentário) de migrations já aplicadas:
--   20260213000100_add_portal_access_models  (2×)
--   20260730190000_add_client_session        (ClientSession_userId_fkey)
--   20260814160000_add_contato_whatsapp_usuario
-- É esse nome, capitalizado e entre aspas, que vai abaixo.
--
-- ⚠ A TABELA NOVA, por outro lado, é `password_reset_tokens` (snake_case), e o `schema.prisma`
-- declara `@@map("password_reset_tokens")`. Isso é deliberado e é a defesa contra o erro acima:
-- quem criar uma FK para cá no futuro acha o nome com o mesmo `grep`, e o `@@map` explícito não
-- deixa o nome do MODEL (`PasswordResetToken`) passar por nome de tabela. É a convenção das
-- tabelas novas do projeto — `envios_guia`, `conversas_whatsapp`, `onboardings`, `obrigacoes`.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) A TABELA — ADITIVA. Nenhuma tabela existente é alterada, nenhuma coluna é removida.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ NÃO EXISTE COLUNA COM O TOKEN EM CLARO, e a ausência é a decisão principal deste arquivo.
-- Guarda-se o SHA-256 (`tokenHash`), do mesmo jeito que `ClientSession.refreshTokenHash` já faz
-- com o refresh opaco. O valor em claro vive dentro de uma requisição, entra no corpo do e-mail e
-- morre ali. Dump do banco vazado não entrega nenhuma senha redefinível.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    -- SHA-256 em hex: 64 caracteres. TEXT (não CHAR(64)) para acompanhar `refreshTokenHash`, que
    -- também é TEXT — trocar o algoritmo de digest um dia não deve exigir migration de tipo.
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Prazo curto. O valor é decidido na APLICAÇÃO (`PASSWORD_RESET_TTL_MINUTES`, em config.js),
    -- não aqui: prazo é política, e política que vira DEFAULT de coluna só muda com migration.
    "expiresAt" TIMESTAMP(3) NOT NULL,
    -- ⚠ A COLUNA DO USO ÚNICO. NULO = ainda não usado; preenchida = queimada, para sempre.
    -- Sem ela o token é reutilizável, e um link de redefinição que continua valendo depois de
    -- usado é uma senha permanente escondida na caixa de e-mail.
    "usedAt" TIMESTAMP(3),
    -- Auditoria de QUEM PEDIU. Nunca entra em decisão de autorização (IP não autentica ninguém);
    -- existe para responder "de onde veio a enxurrada de pedidos?" depois do fato.
    "requestIp" TEXT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) ÍNDICES
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ `tokenHash` é UNIQUE, e não é só higiene: a validação do token é UM `findUnique` pelo hash.
-- Sem o índice único, validar exigiria varrer a tabela — e uma busca cujo tempo varia com o
-- conteúdo é justamente o tipo de canal lateral que este desenho evita.
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_key"
  ON "password_reset_tokens"("tokenHash");

-- Usado para invalidar em lote os pedidos pendentes de um usuário quando um deles é consumido.
CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_idx"
  ON "password_reset_tokens"("userId");

-- Usado pela limpeza de tokens vencidos (a linha não serve para mais nada depois do prazo).
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expiresAt_idx"
  ON "password_reset_tokens"("expiresAt");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) A FK — para `"User"`, com ON DELETE CASCADE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ CASCADE aqui é diferente do CASCADE de auditoria que outras tabelas evitam de propósito
-- (`emissaoClienteLiberadaPor` é TEXT solto justamente para o rastro sobreviver ao usuário).
-- Este registro NÃO é rastro: é uma CREDENCIAL VIVA. Usuário apagado não pode deixar para trás
-- um token que ainda redefine a senha de um id que não existe mais. Mesma escolha de
-- `ClientSession_userId_fkey`, que é a outra credencial viva do projeto.
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) NENHUM BACKFILL, NENHUM CHECK — de propósito
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Não há UPDATE: a tabela nasce vazia porque não existe, em lugar nenhum do banco, um pedido de
-- redefinição pendente a preservar — a funcionalidade não existia até agora.
--
-- Não há CHECK: o domínio das colunas já é garantido pelos tipos, e a única regra que importa
-- ("token vencido ou usado não vale") é uma COMPARAÇÃO COM `now()` no momento da leitura, não uma
-- invariante de linha. CHECK que compara com o relógio não é IMMUTABLE e o Postgres o recusa —
-- migration que falha é P3009 e servidor que não sobe.
