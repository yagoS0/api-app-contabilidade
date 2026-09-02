-- ⚠⚠ ADITIVA. Tabela nova, nada existente é tocado.
--
-- A decisão do contador de trazer as notas recebidas para a fila SOZINHO, a partir de uma data que
-- ELE escolheu. Empresa sem linha aqui não é varrida automaticamente — ninguém escolheu o piso dela.
CREATE TABLE "varreduras_automaticas_de_notas" (
    "portalClientId" TEXT NOT NULL,
    "dataPiso" DATE NOT NULL,
    "ligadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ligadaPor" TEXT,
    "ultimaTentativaEm" TIMESTAMP(3),
    "ultimoResultadoEm" TIMESTAMP(3),
    "ultimoCriados" INTEGER,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "varreduras_automaticas_de_notas_pkey" PRIMARY KEY ("portalClientId")
);

CREATE INDEX "varreduras_automaticas_de_notas_ultimaTentativaEm_idx"
    ON "varreduras_automaticas_de_notas"("ultimaTentativaEm");

ALTER TABLE "varreduras_automaticas_de_notas"
    ADD CONSTRAINT "varreduras_automaticas_de_notas_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
