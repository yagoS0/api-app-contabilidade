CREATE TABLE "nfse_consultas_municipais" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "autorId" TEXT NOT NULL,
  "ambiente" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "municipio" TEXT NOT NULL,
  "recurso" TEXT NOT NULL,
  "codigoServico" TEXT,
  "origem" TEXT NOT NULL,
  "caminho" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "resposta" JSONB,
  "httpStatus" INTEGER,
  "erroCodigo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "concluidaEm" TIMESTAMP(3),
  CONSTRAINT "nfse_consultas_municipais_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nfse_consultas_municipais_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nfse_consultas_municipais_ambiente_check" CHECK ("ambiente" IN ('homolog', 'producao')),
  CONSTRAINT "nfse_consultas_municipais_recurso_check" CHECK ("recurso" IN ('convenio', 'servico')),
  CONSTRAINT "nfse_consultas_municipais_status_check" CHECK ("status" IN ('CONSULTANDO', 'RECEBIDO_PARA_CONFERENCIA', 'FALHOU'))
);
CREATE UNIQUE INDEX "nfse_consultas_municipais_companyId_ambiente_requestKey_key" ON "nfse_consultas_municipais"("companyId", "ambiente", "requestKey");
CREATE INDEX "nfse_consultas_municipais_companyId_ambiente_createdAt_idx" ON "nfse_consultas_municipais"("companyId", "ambiente", "createdAt");
