-- ENTREGA DE OBRIGACAO POR ARQUIVO — o rastro de "gerar -> transmitir no PVA -> recibo".
--
-- Generico de proposito: EFD-Contribuicoes, ECD, ECF e EFD-Fiscal seguem o mesmo ciclo. Uma tabela
-- por obrigacao seria a mesma estrutura copiada quatro vezes, e a quarta divergiria.
--
-- `transmitidaEm` e MARCA MANUAL: o app nao transmite nem gera o arquivo (nao possui o leiaute).
-- O que ele guarda e o RASTRO — sem ele, "a EFD de marco foi entregue?" so se responde abrindo o
-- programa oficial.
CREATE TABLE "entregas_obrigacao_arquivo" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "arquivoFileId" TEXT,
    "arquivoNome" TEXT,
    "reciboFileId" TEXT,
    "reciboNome" TEXT,
    "transmitidaEm" TIMESTAMP(3),
    "transmitidaPorId" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entregas_obrigacao_arquivo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entregas_obrigacao_arquivo_portalClientId_tipo_idx" ON "entregas_obrigacao_arquivo"("portalClientId", "tipo");

-- Uma entrega por empresa, por tipo, por competencia.
CREATE UNIQUE INDEX "entregas_obrigacao_arquivo_portalClientId_tipo_competencia_key" ON "entregas_obrigacao_arquivo"("portalClientId", "tipo", "competencia");
