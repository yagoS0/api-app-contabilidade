-- WhatsApp — Entrega 1: contato do cliente e o estado de envio por CANAL.
--
-- `envios_guia` existe porque `Guide.emailStatus` era o estado de envio da guia (é dele que o chip
-- da listagem e o guideCompliance derivam "enviada"). Um campo só não representa "enviada por
-- WhatsApp e ainda não por e-mail". Aditiva: `emailStatus` continua onde está, como detalhe de
-- transporte do e-mail.

ALTER TABLE "PortalClient" ADD COLUMN "canalPadraoEnvio" TEXT NOT NULL DEFAULT 'EMAIL';

CREATE TABLE "contatos_whatsapp" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "papel" TEXT,
    "telefoneE164" TEXT NOT NULL,
    "waId" TEXT,
    "optInEm" TIMESTAMP(3),
    "optInOrigem" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contatos_whatsapp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "envios_guia" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "destino" TEXT,
    "providerMessageId" TEXT,
    "erroCodigo" TEXT,
    "erroMensagemUsuario" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "envios_guia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contatos_whatsapp_portalClientId_telefoneE164_key" ON "contatos_whatsapp"("portalClientId", "telefoneE164");
CREATE INDEX "contatos_whatsapp_waId_idx" ON "contatos_whatsapp"("waId");

-- É esta constraint que torna reexecutar o lote inofensivo.
CREATE UNIQUE INDEX "envios_guia_guideId_canal_key" ON "envios_guia"("guideId", "canal");
CREATE INDEX "envios_guia_status_proximaTentativaEm_idx" ON "envios_guia"("status", "proximaTentativaEm");
CREATE INDEX "envios_guia_providerMessageId_idx" ON "envios_guia"("providerMessageId");

ALTER TABLE "contatos_whatsapp" ADD CONSTRAINT "contatos_whatsapp_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "envios_guia" ADD CONSTRAINT "envios_guia_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
