-- CreateTable
CREATE TABLE "serpro_chamadas" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "portalClientId" TEXT,
    "idSistema" TEXT,
    "idServico" TEXT,
    "rota" TEXT NOT NULL,
    "assinatura" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "erroCodigo" TEXT,
    "duracaoMs" INTEGER,
    "origem" TEXT,
    "userId" TEXT,
    "forcado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serpro_chamadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serpro_chamadas_cnpj_createdAt_idx" ON "serpro_chamadas"("cnpj", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "serpro_chamadas_portalClientId_createdAt_idx" ON "serpro_chamadas"("portalClientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "serpro_chamadas_idServico_createdAt_idx" ON "serpro_chamadas"("idServico", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "serpro_chamadas_assinatura_createdAt_idx" ON "serpro_chamadas"("assinatura", "createdAt" DESC);
