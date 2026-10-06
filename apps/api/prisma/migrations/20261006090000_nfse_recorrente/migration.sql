CREATE TABLE "NfseRecorrencia" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "autorizadoPor" TEXT NOT NULL,
  "ambiente" TEXT NOT NULL, "dia" INTEGER NOT NULL, "proximaData" TEXT NOT NULL,
  "ativa" BOOLEAN NOT NULL DEFAULT true, "versao" INTEGER NOT NULL DEFAULT 0,
  "modelo" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "NfseRecorrencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NfseRecorrencia_dia_check" CHECK ("dia" BETWEEN 1 AND 31)
);
CREATE INDEX "NfseRecorrencia_companyId_idx" ON "NfseRecorrencia"("companyId");
CREATE INDEX "NfseRecorrencia_ativa_proximaData_idx" ON "NfseRecorrencia"("ativa", "proximaData");
CREATE TABLE "NfseRecorrenciaExecucao" (
  "id" TEXT NOT NULL, "recorrenciaId" TEXT NOT NULL, "competencia" TEXT NOT NULL,
  "dataPrevista" TEXT NOT NULL, "status" TEXT NOT NULL, "invoiceId" TEXT, "erro" TEXT,
  "modelo" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), CONSTRAINT "NfseRecorrenciaExecucao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NfseRecorrenciaExecucao_recorrenciaId_fkey" FOREIGN KEY ("recorrenciaId") REFERENCES "NfseRecorrencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NfseRecorrenciaExecucao_recorrenciaId_competencia_key" ON "NfseRecorrenciaExecucao"("recorrenciaId", "competencia");
