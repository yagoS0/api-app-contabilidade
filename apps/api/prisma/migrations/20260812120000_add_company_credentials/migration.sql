-- COFRE DE CREDENCIAIS DA EMPRESA + "outras informações" + auditoria de leitura.
--
-- ⚠ ADITIVA. Nenhuma tabela existente é alterada, nenhuma coluna é dropada, nenhum dado é tocado.
--
-- ⚠ A CIFRA NÃO É NOVA. `company_credentials."senhaCifrada"` guarda o retorno de
-- `apps/api/src/utils/crypto.js` `encryptSecret` — o MESMO caminho do certificado A1: AES-256-GCM
-- com envelope encryption via AWS KMS quando `AWS_KMS_CERT_KEY_ID` está setado (blob com prefixo
-- `kms-v1:`), caindo para chave derivada de `CERT_SECRET_KEY` quando não (prefixo `v1:`). Por isso
-- a coluna é TEXT e não BYTEA: o formato é auto-descritivo e a leitura escolhe pelo prefixo, o que
-- torna a migração de formato LAZY (segredo antigo continua legível depois de ligar o KMS).
--
-- ⚠ POR QUE TRÊS TABELAS E NÃO UMA COM `secreto BOOLEAN`
-- "Credencial" e "outra informação" têm PROTEÇÃO DIFERENTE, e a diferença precisa estar visível
-- antes de a pessoa digitar. Um campo que parece cofre e não é vale menos que campo nenhum. Duas
-- tabelas → duas seções na tela → dois avisos → nenhuma ambiguidade sobre onde o valor vai parar.

-- ── 1. As credenciais (senha cifrada) ────────────────────────────────────────────────────────
CREATE TABLE "company_credentials" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,

  -- Rótulo LIVRE ("gov.br", "Prefeitura SP", "Portal do banco"). Lista fechada envelheceria na
  -- primeira prefeitura nova.
  "rotulo" TEXT NOT NULL,
  -- Login em claro, de propósito: sozinho ele não abre nada, e cifrá-lo esconderia da listagem
  -- justamente o dado que identifica de qual acesso se está falando.
  "login"  TEXT,
  -- ⚠ CIFRADA (`encryptSecret`). NULL = credencial sem senha (só login/observação) — caso legítimo.
  "senhaCifrada" TEXT,
  -- ⚠ NÃO CIFRADA. A tela diz isso.
  "observacao" TEXT,

  "criadoPorId"     TEXT,
  "atualizadoPorId" TEXT,
  -- Quando a SENHA mudou (≠ updatedAt, que sobe ao editar rótulo/observação).
  "senhaAtualizadaEm" TIMESTAMP(3),

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_credentials_portalClientId_idx" ON "company_credentials"("portalClientId");

ALTER TABLE "company_credentials"
  ADD CONSTRAINT "company_credentials_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rótulo vazio deixa a linha impossível de identificar na listagem — e a listagem é a única coisa
-- que se vê sem revelar nada.
ALTER TABLE "company_credentials"
  ADD CONSTRAINT "chk_credential_rotulo" CHECK (length(btrim("rotulo")) >= 1);

-- ⚠ CINTO CONTRA SENHA EM CLARO NA COLUNA CIFRADA.
-- `encryptSecret` sempre devolve `v1:` ou `kms-v1:` — `decryptSecret` tem um ramo de compat que
-- devolve valor legado em claro "como está", e é justamente esse ramo que tornaria um INSERT
-- direto (script, psql, caminho novo que esqueceu de cifrar) INVISÍVEL: leria de volta certinho.
-- Aqui não há legado a tolerar — a tabela nasce vazia —, então o banco recusa qualquer coisa que
-- não tenha saído do cifrador.
ALTER TABLE "company_credentials"
  ADD CONSTRAINT "chk_credential_senha_cifrada"
  CHECK ("senhaCifrada" IS NULL OR "senhaCifrada" ~ '^(v1|kms-v1):');

-- ── 2. "Outras informações" (texto livre, NÃO cifrado) ───────────────────────────────────────
CREATE TABLE "company_infos" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,

  "rotulo" TEXT NOT NULL,
  "valor"  TEXT NOT NULL,

  "criadoPorId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_infos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_infos_portalClientId_idx" ON "company_infos"("portalClientId");

ALTER TABLE "company_infos"
  ADD CONSTRAINT "company_infos_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_infos"
  ADD CONSTRAINT "chk_info_rotulo" CHECK (length(btrim("rotulo")) >= 1);

-- ── 3. Auditoria de acesso ao cofre ──────────────────────────────────────────────────────────
--
-- Mesmo desenho de `estornos_baixa` (20260808150000) e `atos_parcelamento` (20260810160000):
-- tabela própria, append-only, com CÓPIA imutável do que era o registro no momento do ato.
--
-- ⚠ `credentialId` é ON DELETE SET NULL e `rotuloNoMomento` é NOT NULL: o registro de "fulano viu
-- a senha do gov.br em tal dia" precisa sobreviver à exclusão da credencial. Um log apontando para
-- um id que não existe mais não conta história nenhuma.
--
-- ⚠ NADA DA SENHA ENTRA AQUI — nem texto claro, nem blob cifrado, nem hash, nem comprimento.
CREATE TABLE "company_credential_acessos" (
  "id"             TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "credentialId"   TEXT,

  -- REVELADA        = alguém viu o valor  ← é esta que dá sentido à tabela
  -- CRIADA | ATUALIZADA | SENHA_ALTERADA | REMOVIDA = para o histórico não ter buracos entre
  --                                                   uma leitura e outra
  "acao" TEXT NOT NULL,

  "rotuloNoMomento" TEXT NOT NULL,

  "usuarioId"    TEXT,
  "usuarioEmail" TEXT,
  "motivo"       TEXT,
  "ip"           TEXT,
  "userAgent"    TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "company_credential_acessos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_credential_acessos_portalClientId_createdAt_idx"
  ON "company_credential_acessos"("portalClientId", "createdAt");
CREATE INDEX "company_credential_acessos_credentialId_createdAt_idx"
  ON "company_credential_acessos"("credentialId", "createdAt");

ALTER TABLE "company_credential_acessos"
  ADD CONSTRAINT "company_credential_acessos_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "company_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_credential_acessos"
  ADD CONSTRAINT "company_credential_acessos_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_credential_acessos"
  ADD CONSTRAINT "chk_acesso_acao"
  CHECK ("acao" IN ('REVELADA', 'CRIADA', 'ATUALIZADA', 'SENHA_ALTERADA', 'REMOVIDA'));
