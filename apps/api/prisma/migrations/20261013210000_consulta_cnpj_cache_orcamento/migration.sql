CREATE TABLE "ConsultaCnpjCache" (
  "chave" TEXT PRIMARY KEY,
  "escopo" TEXT NOT NULL,
  "cnpj" TEXT NOT NULL,
  "modalidade" TEXT NOT NULL CHECK ("modalidade" IN ('BASICA','EMPRESA','QSA')),
  "conteudo" TEXT,
  "expiraEm" TIMESTAMPTZ,
  "lease" TEXT,
  "leaseAte" TIMESTAMPTZ,
  "atualizadoEm" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ConsultaCnpjCache_expiraEm_idx" ON "ConsultaCnpjCache"("expiraEm");
CREATE TABLE "ConsultaCnpjOrcamento" (
  "id" TEXT PRIMARY KEY,
  "habilitado" BOOLEAN NOT NULL DEFAULT false,
  "limiteMicros" BIGINT NOT NULL DEFAULT 0 CHECK ("limiteMicros" >= 0),
  "basicaMicros" BIGINT NOT NULL DEFAULT 0 CHECK ("basicaMicros" >= 0),
  "empresaMicros" BIGINT NOT NULL DEFAULT 0 CHECK ("empresaMicros" >= 0),
  "qsaMicros" BIGINT NOT NULL DEFAULT 0 CHECK ("qsaMicros" >= 0),
  "precosAte" TIMESTAMPTZ
);
CREATE TABLE "ConsultaCnpjReserva" (
  "id" TEXT PRIMARY KEY,
  "orcamentoId" TEXT NOT NULL REFERENCES "ConsultaCnpjOrcamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" TEXT NOT NULL,
  "escopo" TEXT NOT NULL,
  "cnpj" TEXT NOT NULL,
  "modalidade" TEXT NOT NULL CHECK ("modalidade" IN ('BASICA','EMPRESA','QSA')),
  "mes" TEXT NOT NULL,
  "custoMicros" BIGINT NOT NULL CHECK ("custoMicros" > 0),
  "status" TEXT NOT NULL DEFAULT 'RESERVADA' CHECK ("status" IN ('RESERVADA','CONCLUIDA','INCERTA')),
  "criadaEm" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "concluidaEm" TIMESTAMPTZ,
  UNIQUE ("orcamentoId", "requestKey")
);
CREATE INDEX "ConsultaCnpjReserva_mes_idx" ON "ConsultaCnpjReserva"("orcamentoId","mes");
CREATE INDEX "ConsultaCnpjReserva_documento_idx" ON "ConsultaCnpjReserva"("orcamentoId","escopo","cnpj","modalidade");
-- Instalar a migration não contrata, configura preços nem habilita consultas pagas.
INSERT INTO "ConsultaCnpjOrcamento" ("id") VALUES ('ALTAN');
