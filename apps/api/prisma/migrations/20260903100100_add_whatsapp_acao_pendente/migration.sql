-- WhatsApp — Entrega 2 (02/09/2026): a AÇÃO QUE A IA PREPAROU E O CLIENTE AINDA NÃO CONFIRMOU.
--
-- ⚠⚠ É o protocolo que separa "a IA montou" de "a nota saiu". A IA nunca emite/cancela/recalcula;
-- ela grava aqui o payload como a rota do cliente receberia, o texto que o cliente LEU (a
-- declaração inteira) e um código de 4 caracteres. Só "CONFIRMAR <código>" executa, e a execução
-- é uma reserva atômica (`status = 'pendente' AND "expiraEm" > now()`), lendo o count.

CREATE TABLE "acoes_pendentes_whatsapp" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "userId" TEXT,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "textoDeConfirmacao" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "confirmadaEm" TIMESTAMP(3),
    "executadaEm" TIMESTAMP(3),
    "resultado" JSONB,
    "mensagemConfirmacaoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acoes_pendentes_whatsapp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acoes_pendentes_whatsapp_conversaId_status_idx" ON "acoes_pendentes_whatsapp"("conversaId", "status");
CREATE INDEX "acoes_pendentes_whatsapp_expiraEm_idx" ON "acoes_pendentes_whatsapp"("expiraEm");

ALTER TABLE "acoes_pendentes_whatsapp"
  ADD CONSTRAINT "acoes_pendentes_whatsapp_conversaId_fkey"
  FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acoes_pendentes_whatsapp"
  ADD CONSTRAINT "acoes_pendentes_whatsapp_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acoes_pendentes_whatsapp"
  ADD CONSTRAINT "acoes_pendentes_whatsapp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vocabulários fechados: tipo novo e estado novo entram por migration, nunca por string solta.
ALTER TABLE "acoes_pendentes_whatsapp"
  ADD CONSTRAINT "chk_acao_pendente_whatsapp_tipo"
  CHECK ("tipo" IN ('EMITIR_NFSE', 'CANCELAR_NFSE', 'RECALCULAR_GUIA'));
ALTER TABLE "acoes_pendentes_whatsapp"
  ADD CONSTRAINT "chk_acao_pendente_whatsapp_status"
  CHECK ("status" IN ('pendente', 'confirmada', 'executada', 'expirada', 'cancelada'));
