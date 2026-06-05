-- Q12.C.1: Apuração PGDAS-D + classificação de itens por anexo SN.
-- 3 tabelas novas, todas aditivas (CREATE TABLE).

-- ─── apuracoes ───────────────────────────────────────────────────────────
CREATE TABLE "apuracoes" (
  "id"               TEXT NOT NULL,
  "portalClientId"   TEXT NOT NULL,
  "competencia"      TEXT NOT NULL,
  "estado"           TEXT NOT NULL DEFAULT 'pendente',
  "idempotencyKey"   TEXT NOT NULL,
  "rb12"             DECIMAL(18,2) NOT NULL,
  "fs12"             DECIMAL(18,2),
  "fatorR"           DECIMAL(6,4),
  "receitaMes"       DECIMAL(18,2) NOT NULL,
  "receitaPorAnexo"  JSONB NOT NULL,
  "dasValor"         DECIMAL(18,2),
  "numeroDeclaracao" TEXT,
  "reciboNumero"     TEXT,
  "transmitidoEm"    TIMESTAMP(3),
  "erroMensagem"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "apuracoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "apuracoes_idempotencyKey_key" ON "apuracoes"("idempotencyKey");
CREATE UNIQUE INDEX "apuracoes_portalClientId_competencia_key" ON "apuracoes"("portalClientId", "competencia");
CREATE INDEX "apuracoes_estado_idx" ON "apuracoes"("estado");
CREATE INDEX "apuracoes_portalClientId_estado_idx" ON "apuracoes"("portalClientId", "estado");

ALTER TABLE "apuracoes"
  ADD CONSTRAINT "apuracoes_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── apuracao_divergencias ───────────────────────────────────────────────
CREATE TABLE "apuracao_divergencias" (
  "id"          TEXT NOT NULL,
  "apuracaoId"  TEXT NOT NULL,
  "tipo"        TEXT NOT NULL,
  "severidade"  TEXT NOT NULL DEFAULT 'WARN',
  "descricao"   TEXT NOT NULL,
  "esperado"    TEXT,
  "obtido"      TEXT,
  "tolerado"    BOOLEAN NOT NULL DEFAULT false,
  "resolvida"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "apuracao_divergencias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "apuracao_divergencias_apuracaoId_idx" ON "apuracao_divergencias"("apuracaoId");
CREATE INDEX "apuracao_divergencias_tipo_severidade_idx" ON "apuracao_divergencias"("tipo", "severidade");

ALTER TABLE "apuracao_divergencias"
  ADD CONSTRAINT "apuracao_divergencias_apuracaoId_fkey"
  FOREIGN KEY ("apuracaoId") REFERENCES "apuracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── deparas_anexo ───────────────────────────────────────────────────────
CREATE TABLE "deparas_anexo" (
  "id"              TEXT NOT NULL,
  "escopo"          TEXT NOT NULL,
  "portalClientId"  TEXT,
  "tipoCodigo"      TEXT NOT NULL,
  "codigo"          TEXT NOT NULL,
  "anexoResolvido"  TEXT NOT NULL,
  "sujeitoFatorR"   BOOLEAN NOT NULL DEFAULT false,
  "descricao"       TEXT,
  "aprendidoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "deparas_anexo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deparas_anexo_escopo_portalClientId_tipoCodigo_codigo_key"
  ON "deparas_anexo"("escopo", "portalClientId", "tipoCodigo", "codigo");
CREATE INDEX "deparas_anexo_tipoCodigo_codigo_idx" ON "deparas_anexo"("tipoCodigo", "codigo");

ALTER TABLE "deparas_anexo"
  ADD CONSTRAINT "deparas_anexo_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
