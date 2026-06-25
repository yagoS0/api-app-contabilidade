-- Q28 Fase 1: configuração de lançamento POR PARCELAMENTO (provisão/pagamento independentes).
-- ADD-only: sem DROP, sem reset. Campos JSON nulos (parcelamentos existentes seguem usando os
-- papéis padrão + MapaContaTributo até ganharem config própria).
ALTER TABLE "parcelamentos" ADD COLUMN "configProvisao" JSONB,
ADD COLUMN "configPagamento" JSONB;
