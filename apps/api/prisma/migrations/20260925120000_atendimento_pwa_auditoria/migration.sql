-- Aditiva: preserve histórico e clientes antigos durante atualização da API/web.
ALTER TABLE "mensagens_whatsapp" ADD COLUMN "intencaoEnvioId" TEXT;
CREATE UNIQUE INDEX "mensagens_whatsapp_intencaoEnvioId_key" ON "mensagens_whatsapp"("intencaoEnvioId");
ALTER TABLE "envios_guia_tentativas" ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "arquivoPdfFileId" TEXT, ADD COLUMN "arquivoSha256" TEXT;
CREATE TABLE "IntencaoEnvioAtendimento" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "clientRequestId" TEXT NOT NULL,
  "conversaId" TEXT NOT NULL, "canalId" TEXT, "destinoHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RESERVADA',
  "mensagemId" TEXT, "resultado" JSONB, "erroCodigo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntencaoEnvioAtendimento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntencaoEnvioAtendimento_userId_clientRequestId_key" ON "IntencaoEnvioAtendimento"("userId", "clientRequestId");
CREATE INDEX "IntencaoEnvioAtendimento_conversaId_createdAt_idx" ON "IntencaoEnvioAtendimento"("conversaId", "createdAt");
CREATE TABLE "RascunhoAtendimento" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "chaveEscopo" TEXT NOT NULL,
  "conversaId" TEXT NOT NULL, "conteudo" JSONB NOT NULL, "versao" INTEGER NOT NULL DEFAULT 1,
  "expiraEm" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RascunhoAtendimento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RascunhoAtendimento_userId_chaveEscopo_key" ON "RascunhoAtendimento"("userId", "chaveEscopo");
CREATE INDEX "RascunhoAtendimento_expiraEm_idx" ON "RascunhoAtendimento"("expiraEm");
CREATE TABLE "InscricaoPushAtendimento" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "endpointHash" TEXT NOT NULL,
  "subscription" JSONB NOT NULL, "deviceName" TEXT NOT NULL, "vinculo" TEXT NOT NULL,
  "minhas" BOOLEAN NOT NULL DEFAULT true, "fila" BOOLEAN NOT NULL DEFAULT true,
  "ativa" BOOLEAN NOT NULL DEFAULT true, "revogadaEm" TIMESTAMP(3),
  "ativadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InscricaoPushAtendimento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InscricaoPushAtendimento_endpointHash_key" ON "InscricaoPushAtendimento"("endpointHash");
CREATE INDEX "InscricaoPushAtendimento_userId_ativa_idx" ON "InscricaoPushAtendimento"("userId", "ativa");
CREATE TABLE "EventoPushAtendimento" (
  "id" TEXT NOT NULL, "conversaId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiraEm" TIMESTAMP(3) NOT NULL,
  "processadoEm" TIMESTAMP(3), CONSTRAINT "EventoPushAtendimento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventoPushAtendimento_processadoEm_createdAt_idx" ON "EventoPushAtendimento"("processadoEm", "createdAt");
CREATE TABLE "EntregaPushAtendimento" (
  "id" TEXT NOT NULL, "eventoId" TEXT NOT NULL, "inscricaoId" TEXT NOT NULL,
  "vinculo" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDENTE', "tentativas" INTEGER NOT NULL DEFAULT 0,
  "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reservaToken" TEXT,
  "leaseAte" TIMESTAMP(3), "erroCodigo" TEXT, "aceitaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntregaPushAtendimento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntregaPushAtendimento_eventoId_inscricaoId_key" ON "EntregaPushAtendimento"("eventoId", "inscricaoId");
CREATE INDEX "EntregaPushAtendimento_status_proximaTentativaEm_idx" ON "EntregaPushAtendimento"("status", "proximaTentativaEm");
