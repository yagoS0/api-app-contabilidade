-- A SAÍDA AVULSA QUE O CLIENTE PLANEJOU (29/08/2026)
--
-- Decisão do dono: o cliente pode acrescentar saídas ao próprio fluxo de caixa, e elas aparecem
-- para o contador na Conferência. O que se REPETE vira `series_recorrentes` (origem DECLARADA);
-- o que acontece UMA vez, com data, mora aqui.
--
-- ⚠⚠ ADITIVA E ISOLADA: tabela NOVA, que nenhuma consulta existente lê. Nada é alterado, nada é
-- apagado, e o serviço de fluxo trata a ausência dela (P2021) como "sem saídas", exatamente como já
-- faz com `series_recorrentes`.
--
-- ⚠ `data` é DATE, não TIMESTAMP: é data CIVIL (o dia em que o cliente acha que vai pagar). Com
-- timestamp, às 22h de Brasília a leitura em UTC devolveria o dia seguinte.
--
-- ⚠ A FK aponta para "PortalClient" (sem @@map, conferido contra a migration da série e contra o
-- DDL real) — NÃO para "portal_clients". É a mesma conferência que a migration do reset de senha
-- registra: nome de tabela se confere no DDL, nunca no nome do model.
--
-- ⚠⚠ NADA AQUI VIRA LANÇAMENTO CONTÁBIL. Esta tabela não afirma que o dinheiro saiu — por isso ela
-- NÃO é um `lancamentos_declarados`, cuja invariante nº 1 exige data de pagamento.

CREATE TABLE "saidas_avulsas_cliente" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "motivoRecusa" TEXT,
    "criadaPor" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididaPor" TEXT,
    "decididaEm" TIMESTAMP(3),

    CONSTRAINT "saidas_avulsas_cliente_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saidas_avulsas_cliente_portalClientId_estado_idx" ON "saidas_avulsas_cliente"("portalClientId", "estado");

-- ⚠ A leitura do fluxo varre por empresa + janela de datas; sem este índice ela vira scan.
CREATE INDEX "saidas_avulsas_cliente_portalClientId_data_idx" ON "saidas_avulsas_cliente"("portalClientId", "data");

ALTER TABLE "saidas_avulsas_cliente" ADD CONSTRAINT "saidas_avulsas_cliente_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
