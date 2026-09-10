-- AlterTable
ALTER TABLE "PortalClient" ADD COLUMN     "apelidosWhatsapp" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "conversas_whatsapp" ADD COLUMN     "atendimentoId" TEXT;

-- AlterTable
ALTER TABLE "mensagens_whatsapp" ADD COLUMN     "respostaAProviderMessageId" TEXT;

-- AlterTable
ALTER TABLE "turnos_ia_whatsapp" ADD COLUMN     "atendimentoId" TEXT,
ADD COLUMN     "contextoVersao" INTEGER;

-- AlterTable
ALTER TABLE "acoes_pendentes_whatsapp" ADD COLUMN     "atendimentoId" TEXT,
ADD COLUMN     "contextoVersao" INTEGER;

-- AlterTable
ALTER TABLE "rascunhos_emissao_whatsapp" ADD COLUMN     "atendimentoId" TEXT,
ADD COLUMN     "contextoVersao" INTEGER;

-- CreateTable
CREATE TABLE "atendimentos_responsaveis_whatsapp" (
    "id" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'principal',
    "telefoneE164" TEXT NOT NULL,
    "userId" TEXT,
    "portalClientId" TEXT,
    "conversaId" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "aguardandoSelecao" BOOLEAN NOT NULL DEFAULT true,
    "pedidoPendente" TEXT,
    "coletaPendenteConversaId" TEXT,
    "interacaoPendente" JSONB,
    "empresaIdsOferecidos" JSONB,
    "expiraEm" TIMESTAMP(3),
    "ultimaInteracaoEm" TIMESTAMP(3),
    "ultimaMensagemId" TEXT,
    "atendidaPor" TEXT,
    "atendidaDesde" TIMESTAMP(3),
    "automacaoInvalidadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atendimentos_responsaveis_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolucoes_contexto_whatsapp" (
    "mensagemId" TEXT NOT NULL,
    "atendimentoId" TEXT NOT NULL,
    "conversaId" TEXT,
    "portalClientId" TEXT,
    "versao" INTEGER NOT NULL,
    "estado" TEXT NOT NULL,
    "tipo" TEXT,
    "texto" TEXT,
    "interacao" JSONB,
    "resultado" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolucoes_contexto_whatsapp_pkey" PRIMARY KEY ("mensagemId")
);

-- CreateIndex
CREATE INDEX "atendimentos_responsaveis_whatsapp_telefoneE164_idx" ON "atendimentos_responsaveis_whatsapp"("telefoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "atendimentos_responsaveis_whatsapp_canal_telefoneE164_key" ON "atendimentos_responsaveis_whatsapp"("canal", "telefoneE164");

-- CreateIndex
CREATE INDEX "resolucoes_contexto_whatsapp_conversaId_createdAt_idx" ON "resolucoes_contexto_whatsapp"("conversaId", "createdAt");

-- CreateIndex
CREATE INDEX "resolucoes_contexto_whatsapp_atendimentoId_versao_idx" ON "resolucoes_contexto_whatsapp"("atendimentoId", "versao");

-- CreateIndex
CREATE INDEX "conversas_whatsapp_atendimentoId_idx" ON "conversas_whatsapp"("atendimentoId");

-- AddForeignKey
ALTER TABLE "conversas_whatsapp" ADD CONSTRAINT "conversas_whatsapp_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "atendimentos_responsaveis_whatsapp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucoes_contexto_whatsapp" ADD CONSTRAINT "resolucoes_contexto_whatsapp_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucoes_contexto_whatsapp" ADD CONSTRAINT "resolucoes_contexto_whatsapp_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "atendimentos_responsaveis_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucoes_contexto_whatsapp" ADD CONSTRAINT "resolucoes_contexto_whatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acoes_pendentes_whatsapp" ADD CONSTRAINT "acoes_pendentes_whatsapp_atendimentoId_fkey" FOREIGN KEY ("atendimentoId") REFERENCES "atendimentos_responsaveis_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resolucoes_contexto_whatsapp" ADD CONSTRAINT "resolucao_contexto_estado" CHECK (
  "versao" > 0 AND "estado" IN ('RESOLVIDA', 'SELECAO', 'TODAS')
  AND (("estado" = 'RESOLVIDA' AND "conversaId" IS NOT NULL AND "portalClientId" IS NOT NULL)
    OR ("estado" <> 'RESOLVIDA' AND "conversaId" IS NULL AND "portalClientId" IS NULL))
);
ALTER TABLE "atendimentos_responsaveis_whatsapp" ADD CONSTRAINT "atendimento_contexto_versao" CHECK ("versao" > 0);
ALTER TABLE "acoes_pendentes_whatsapp" ADD CONSTRAINT "acao_contexto_completo" CHECK (
  ("atendimentoId" IS NULL AND "contextoVersao" IS NULL) OR ("atendimentoId" IS NOT NULL AND "contextoVersao" > 0)
);
