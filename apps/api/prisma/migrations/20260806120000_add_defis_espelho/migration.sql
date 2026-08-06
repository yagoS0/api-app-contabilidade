-- ESPELHO DA DEFIS — a folha de transcricao de um ano-calendario por empresa.
--
-- `dados` e JSONB de proposito: sao ~40 campos numerados, listas repetiveis (socios,
-- exportadoras, UFs, municipios) e uma ficha por estabelecimento. Modelar em colunas
-- congelaria a estrutura da DEFIS no schema, e ela muda por ato normativo, fora do nosso
-- controle. A forma canonica vive em features/obrigacoes/defis/lib/defisSpec.js, com a
-- citacao do manual oficial da RFB.
--
-- `transmitidaEm` e MARCA MANUAL: a DEFIS e transmitida no portal do Simples Nacional, nunca
-- por nos. A coluna registra que o contador declarou ter transmitido, com o recibo.
CREATE TABLE "defis_espelhos" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "anoCalendario" INTEGER NOT NULL,
    "dados" JSONB NOT NULL,
    "transmitidaEm" TIMESTAMP(3),
    "transmitidaPorId" TEXT,
    "reciboFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defis_espelhos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "defis_espelhos_portalClientId_idx" ON "defis_espelhos"("portalClientId");

-- Um espelho por empresa por ano: reabrir a tela continua o MESMO espelho, nao cria outro.
CREATE UNIQUE INDEX "defis_espelhos_portalClientId_anoCalendario_key" ON "defis_espelhos"("portalClientId", "anoCalendario");
