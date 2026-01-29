-- ADN sync state
CREATE TABLE "AdnSyncState" (
  "id" TEXT PRIMARY KEY DEFAULT 'default',
  "ultimoNSU" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ADN documents
CREATE TABLE "AdnDocument" (
  "id" TEXT PRIMARY KEY,
  "nsu" BIGINT NOT NULL,
  "chaveAcesso" TEXT,
  "tipoDocumento" TEXT,
  "tipoEvento" TEXT,
  "dataHoraGeracao" TIMESTAMP,
  "xmlBase64Gzip" TEXT,
  "xmlPlain" TEXT,
  "dataEmissao" TIMESTAMP,
  "competencia" TIMESTAMP,
  "cnpjPrestador" TEXT,
  "cnpjTomador" TEXT,
  "numeroNfse" TEXT,
  "valorServicos" DECIMAL(18,2),
  "valorIss" DECIMAL(18,2),
  "situacao" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "AdnDocument_nsu_key" ON "AdnDocument" ("nsu");
CREATE INDEX "AdnDocument_chaveAcesso_idx" ON "AdnDocument" ("chaveAcesso");
CREATE INDEX "AdnDocument_competencia_idx" ON "AdnDocument" ("competencia");
CREATE INDEX "AdnDocument_cnpjPrestador_dataEmissao_idx" ON "AdnDocument" ("cnpjPrestador", "dataEmissao");
CREATE INDEX "AdnDocument_cnpjTomador_dataEmissao_idx" ON "AdnDocument" ("cnpjTomador", "dataEmissao");
