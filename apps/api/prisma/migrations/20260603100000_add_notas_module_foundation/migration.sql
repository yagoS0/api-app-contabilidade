-- Q12.A.1: fundação do módulo de Notas Fiscais.
-- Tudo aditivo (ADD COLUMN + CREATE TABLE + CREATE INDEX). Seguro.

-- ─── CompanyMonthlyCircular: máquina de estados por (empresa, competência) ───
ALTER TABLE "company_monthly_circulars"
  ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'aberto',
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "reopenedAt" TIMESTAMP(3),
  ADD COLUMN "reopenedByUserId" TEXT,
  ADD COLUMN "reopenedReason" TEXT,
  ADD COLUMN "fs12Manual" DECIMAL(18,2),
  ADD COLUMN "fs12Origem" TEXT,
  ADD COLUMN "fatorR" DECIMAL(6,4),
  ADD COLUMN "rb12" DECIMAL(18,2);

CREATE INDEX "company_monthly_circulars_portalClientId_estado_idx"
  ON "company_monthly_circulars"("portalClientId", "estado");

-- ─── PortalInvoice: papel (EMIT/DEST), status efetivo, marca pós-fechamento ───
-- Atenção: PortalInvoice NÃO tem @@map → tabela usa PascalCase no banco.
ALTER TABLE "PortalInvoice"
  ADD COLUMN "papel" TEXT,
  ADD COLUMN "statusEfetivo" TEXT,
  ADD COLUMN "competenciaPosFechamento" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "PortalInvoice_papel_idx" ON "PortalInvoice"("papel");
CREATE INDEX "PortalInvoice_statusEfetivo_idx" ON "PortalInvoice"("statusEfetivo");

-- ─── NotaItem: itens de uma nota (NF-e/NFS-e) ───
CREATE TABLE "nota_itens" (
  "id" TEXT NOT NULL,
  "notaId" TEXT NOT NULL,
  "codigoServico" TEXT,
  "ncm" TEXT,
  "cfop" TEXT,
  "descricao" TEXT,
  "valor" DECIMAL(18,2) NOT NULL,
  "anexoResolvido" TEXT,
  "sujeitoFatorR" BOOLEAN NOT NULL DEFAULT false,
  "flagST" BOOLEAN NOT NULL DEFAULT false,
  "flagMonofasico" BOOLEAN NOT NULL DEFAULT false,
  "flagExportacao" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "nota_itens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nota_itens_notaId_idx" ON "nota_itens"("notaId");
CREATE INDEX "nota_itens_anexoResolvido_idx" ON "nota_itens"("anexoResolvido");

ALTER TABLE "nota_itens"
  ADD CONSTRAINT "nota_itens_notaId_fkey"
  FOREIGN KEY ("notaId") REFERENCES "PortalInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── PendenciaPosFechamento: notas chegadas em competência já fechada ───
CREATE TABLE "pendencias_pos_fechamento" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "competencia" TEXT NOT NULL,
  "notaId" TEXT,
  "motivo" TEXT NOT NULL,
  "observacoes" TEXT,
  "resolvida" BOOLEAN NOT NULL DEFAULT false,
  "resolvidaAt" TIMESTAMP(3),
  "resolvidaByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pendencias_pos_fechamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pendencias_pos_fechamento_portalClientId_competencia_resolvida_idx"
  ON "pendencias_pos_fechamento"("portalClientId", "competencia", "resolvida");

ALTER TABLE "pendencias_pos_fechamento"
  ADD CONSTRAINT "pendencias_pos_fechamento_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pendencias_pos_fechamento"
  ADD CONSTRAINT "pendencias_pos_fechamento_notaId_fkey"
  FOREIGN KEY ("notaId") REFERENCES "PortalInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Procuracao: e-CAC do escritório por (empresa, serviço) ───
CREATE TABLE "procuracoes" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "servico" TEXT NOT NULL,
  "validade" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ATIVA',
  "observacoes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "procuracoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "procuracoes_portalClientId_servico_key"
  ON "procuracoes"("portalClientId", "servico");
CREATE INDEX "procuracoes_status_idx" ON "procuracoes"("status");

ALTER TABLE "procuracoes"
  ADD CONSTRAINT "procuracoes_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
