-- WhatsApp — Entrega 2 (02/09/2026): o fio pode ser ASSUMIDO por uma pessoa do escritório, e o
-- balão de saída passa a dizer QUEM o escreveu (IA · humano · sistema).
--
-- ⚠ ADITIVA E NULÁVEL. As mensagens anteriores ficam com `autor` nulo (ninguém sabe quem as
-- escreveu: era o envio de guia, por template). Nenhuma linha é reescrita.

ALTER TABLE "conversas_whatsapp"
  ADD COLUMN "atendidaPor" TEXT,
  ADD COLUMN "atendidaDesde" TIMESTAMP(3);

-- Quem assume é um usuário do ESCRITÓRIO. A saída dele devolve o fio à IA (SetNull), nunca apaga.
ALTER TABLE "conversas_whatsapp"
  ADD CONSTRAINT "conversas_whatsapp_atendidaPor_fkey"
  FOREIGN KEY ("atendidaPor") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mensagens_whatsapp"
  ADD COLUMN "autor" TEXT,
  ADD COLUMN "respondidaPelaIaEm" TIMESTAMP(3);

-- Vocabulário fechado. Nulo é permitido (histórico e mensagens de ENTRADA).
ALTER TABLE "mensagens_whatsapp"
  ADD CONSTRAINT "chk_mensagem_whatsapp_autor"
  CHECK ("autor" IS NULL OR "autor" IN ('IA', 'HUMANO', 'SISTEMA'));
