-- DropIndex
BEGIN;
DROP INDEX "conversas_whatsapp_telefoneE164_key";

-- AlterTable
ALTER TABLE "envios_guia" ADD COLUMN     "tentativaAtualId" TEXT;

-- AlterTable
ALTER TABLE "conversas_whatsapp" ADD COLUMN     "chaveEscopo" TEXT,
ADD COLUMN     "escopoVerificado" BOOLEAN NOT NULL DEFAULT false;

-- Preserva a empresa observada sem afirmar que todo o histórico lhe pertence.
UPDATE "conversas_whatsapp" SET "chaveEscopo" = 'legado:' || COALESCE("portalClientId", 'sem-empresa') || ':' || "id";
ALTER TABLE "conversas_whatsapp" ALTER COLUMN "chaveEscopo" SET NOT NULL;

-- AlterTable
ALTER TABLE "mensagens_whatsapp" ADD COLUMN     "entregueEm" TIMESTAMP(3),
ADD COLUMN     "enviadoEm" TIMESTAMP(3),
ADD COLUMN     "envioGuiaTentativaId" TEXT,
ADD COLUMN     "erroEnvioCodigo" TEXT,
ADD COLUMN     "erroEnvioMensagem" TEXT,
ADD COLUMN     "lidoEm" TIMESTAMP(3),
ADD COLUMN     "statusEnvio" TEXT,
ADD COLUMN     "turnoIaId" TEXT;

-- AlterTable
ALTER TABLE "chamadas_ia" ADD COLUMN     "reservaCentavos" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "envios_guia_tentativas" (
    "id" TEXT NOT NULL,
    "envioGuiaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enviando',
    "providerMessageId" TEXT,
    "erroCodigo" TEXT,
    "erroMensagemUsuario" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aceitoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidoEm" TIMESTAMP(3),

    CONSTRAINT "envios_guia_tentativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_webhook_whatsapp" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservaToken" TEXT,
    "leaseAte" TIMESTAMP(3),
    "erroCodigo" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "inbox_webhook_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos_ia_whatsapp" (
    "id" TEXT NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "portalClientId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservaToken" TEXT,
    "leaseAte" TIMESTAMP(3),
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "turnos_ia_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_leases" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arquivos_whatsapp" (
    "id" TEXT NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "portalClientId" TEXT,
    "midiaProvedorId" TEXT NOT NULL,
    "nomeArquivo" TEXT,
    "mimeType" TEXT,
    "tamanho" INTEGER,
    "sha256" TEXT,
    "conteudo" BYTEA,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "reservadoEm" TIMESTAMP(3),
    "reservaToken" TEXT,
    "erroCodigo" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "importadoEm" TIMESTAMP(3),
    "vinculadoEm" TIMESTAMP(3),
    "vinculadoPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arquivos_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "envios_guia_tentativas_providerMessageId_key" ON "envios_guia_tentativas"("providerMessageId");

-- CreateIndex
CREATE INDEX "envios_guia_tentativas_envioGuiaId_criadoEm_idx" ON "envios_guia_tentativas"("envioGuiaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_webhook_whatsapp_hash_key" ON "inbox_webhook_whatsapp"("hash");

-- CreateIndex
CREATE INDEX "inbox_webhook_whatsapp_status_proximaTentativaEm_idx" ON "inbox_webhook_whatsapp"("status", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_ia_whatsapp_mensagemId_key" ON "turnos_ia_whatsapp"("mensagemId");

-- CreateIndex
CREATE INDEX "turnos_ia_whatsapp_status_proximaTentativaEm_idx" ON "turnos_ia_whatsapp"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "turnos_ia_whatsapp_conversaId_criadoEm_idx" ON "turnos_ia_whatsapp"("conversaId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "arquivos_whatsapp_mensagemId_key" ON "arquivos_whatsapp"("mensagemId");

-- CreateIndex
CREATE INDEX "arquivos_whatsapp_portalClientId_recebidoEm_id_idx" ON "arquivos_whatsapp"("portalClientId", "recebidoEm", "id");

-- CreateIndex
CREATE INDEX "arquivos_whatsapp_estado_proximaTentativaEm_idx" ON "arquivos_whatsapp"("estado", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "arquivos_whatsapp_expiraEm_idx" ON "arquivos_whatsapp"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "conversas_whatsapp_chaveEscopo_key" ON "conversas_whatsapp"("chaveEscopo");

-- CreateIndex
CREATE INDEX "conversas_whatsapp_telefoneE164_idx" ON "conversas_whatsapp"("telefoneE164");

-- CreateIndex
CREATE INDEX "mensagens_whatsapp_turnoIaId_idx" ON "mensagens_whatsapp"("turnoIaId");

-- AddForeignKey
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_envioGuiaTentativaId_fkey" FOREIGN KEY ("envioGuiaTentativaId") REFERENCES "envios_guia_tentativas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_guia_tentativas" ADD CONSTRAINT "envios_guia_tentativas_envioGuiaId_fkey" FOREIGN KEY ("envioGuiaId") REFERENCES "envios_guia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivos_whatsapp" ADD CONSTRAINT "arquivos_whatsapp_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivos_whatsapp" ADD CONSTRAINT "arquivos_whatsapp_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserva correlação antes do primeiro reenvio; inconsistência exige diagnóstico.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "envios_guia" WHERE "canal"='WHATSAPP' AND "providerMessageId" IS NOT NULL GROUP BY "providerMessageId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'WHATSAPP_WAMID_DUPLICADO: conferir envios antes da migration';
  END IF;
END $$;
INSERT INTO "envios_guia_tentativas" ("id","envioGuiaId","status","providerMessageId","erroCodigo","erroMensagemUsuario","criadoEm","aceitoEm","entregueEm","lidoEm")
SELECT 'legado:' || "id", "id", "status", "providerMessageId", "erroCodigo", "erroMensagemUsuario", "createdAt", "enviadoEm", "entregueEm", "lidoEm"
FROM "envios_guia" WHERE "canal"='WHATSAPP' AND "providerMessageId" IS NOT NULL;
UPDATE "envios_guia" SET "tentativaAtualId"='legado:' || "id" WHERE "canal"='WHATSAPP' AND "providerMessageId" IS NOT NULL;
UPDATE "mensagens_whatsapp" m SET "envioGuiaTentativaId"=t."id"
FROM "envios_guia_tentativas" t WHERE m."providerMessageId"=t."providerMessageId" AND m."envioGuiaId"=t."envioGuiaId";

ALTER TABLE "inbox_webhook_whatsapp" ADD CONSTRAINT "inbox_whatsapp_status_check" CHECK ("status" IN ('pendente','processando','concluido','falhou','esgotado'));
ALTER TABLE "turnos_ia_whatsapp" ADD CONSTRAINT "turnos_whatsapp_status_check" CHECK ("status" IN ('pendente','processando','respondido','falhou','indeterminado','ignorado'));
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_status_envio_check" CHECK ("statusEnvio" IS NULL OR "statusEnvio" IN ('pendente','enviando','enviado','entregue','lido','falhou','indeterminado'));

CREATE FUNCTION "proteger_escopo_conversa_whatsapp"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."escopoVerificado" AND OLD."portalClientId" IS DISTINCT FROM NEW."portalClientId" AND NEW."portalClientId" IS NOT NULL THEN
    RAISE EXCEPTION 'WHATSAPP_ESCOPO_IMUTAVEL: abra um novo segmento para a empresa';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "conversa_whatsapp_escopo_imutavel" BEFORE UPDATE OF "portalClientId" ON "conversas_whatsapp" FOR EACH ROW EXECUTE FUNCTION "proteger_escopo_conversa_whatsapp"();
COMMIT;

