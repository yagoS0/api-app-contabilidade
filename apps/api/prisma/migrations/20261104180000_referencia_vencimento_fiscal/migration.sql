-- Candidato aditivo. Não executado. Não contém seeds nem atualização de rotinas.
CREATE TYPE "ReferenciaTipoPeriodo" AS ENUM ('MENSAL', 'TRIMESTRAL');
CREATE TYPE "ReferenciaVencimentoStatus" AS ENUM ('ATIVA', 'REVOGADA');
CREATE TYPE "ReferenciaVencimentoOrigem" AS ENUM ('CONFIRMADA_CONTADOR');
CREATE TABLE "referencias_vencimento_fiscal" (
  "id" TEXT PRIMARY KEY,
  "portalClientId" TEXT NOT NULL REFERENCES "PortalClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tributo" TEXT NOT NULL,
  "tipoPeriodo" "ReferenciaTipoPeriodo" NOT NULL,
  "competencia" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "parcelamentoId" TEXT REFERENCES "parcelamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "numeroParcela" INTEGER,
  "dataCivil" DATE NOT NULL,
  "origem" "ReferenciaVencimentoOrigem" NOT NULL,
  "descricaoFonte" TEXT NOT NULL,
  "status" "ReferenciaVencimentoStatus" NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "confirmedBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ref_vencimento_periodo_check" CHECK (
    ("tipoPeriodo" = 'MENSAL' AND "competencia" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$') OR
    ("tipoPeriodo" = 'TRIMESTRAL' AND "competencia" ~ '^[1-9][0-9]{3}-T[1-4]$')),
  CONSTRAINT "ref_vencimento_target_check" CHECK (
    ("tributo" IN ('DAS','IRPJ','CSLL','PIS','COFINS','ISS','INSS','FGTS') AND "targetKey" = 'TRIBUTO' AND "parcelamentoId" IS NULL AND "numeroParcela" IS NULL) OR
    ("tributo" = 'PARCELAMENTO' AND "parcelamentoId" IS NOT NULL AND "numeroParcela" IS NOT NULL AND "numeroParcela" > 0
      AND "targetKey" = 'PARCELAMENTO:' || "parcelamentoId" || ':' || "numeroParcela"::text))
);
CREATE UNIQUE INDEX "ref_vencimento_ocorrencia_key" ON "referencias_vencimento_fiscal"("portalClientId","tributo","tipoPeriodo","competencia","targetKey");
CREATE INDEX "ref_vencimento_empresa_periodo_idx" ON "referencias_vencimento_fiscal"("portalClientId","competencia","status");
CREATE TABLE "referencias_vencimento_fiscal_eventos" (
  "id" TEXT PRIMARY KEY,
  "referenceId" TEXT NOT NULL REFERENCES "referencias_vencimento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "acao" TEXT NOT NULL CHECK ("acao" IN ('CONFIRMAR','REVOGAR')),
  "motivo" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ref_vencimento_evento_request_key" ON "referencias_vencimento_fiscal_eventos"("actorId","requestId");
CREATE UNIQUE INDEX "ref_vencimento_evento_revision_key" ON "referencias_vencimento_fiscal_eventos"("referenceId","revision");

-- O histórico não é substituído por edição/revogação da projeção vigente.
CREATE FUNCTION impedir_mutacao_referencia_evento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico de referência de vencimento é imutável';
END;
$$;
CREATE TRIGGER ref_vencimento_evento_imutavel BEFORE UPDATE OR DELETE ON "referencias_vencimento_fiscal_eventos"
FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_referencia_evento();
