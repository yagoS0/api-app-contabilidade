-- Contador de documentos recusados pela guarda de CNPJ do ADN.
--
-- Sem ele, uma recusa INDEVIDA (nota de filial, CPF onde o cadastro tem CNPJ, CNPJ digitado errado)
-- é indistinguível de "não havia nota": o documento chega, entra em `totalDocs` e some. Era o único
-- caminho no fluxo capaz de deixar uma empresa sem notas em silêncio.

ALTER TABLE "notas_captura_items" ADD COLUMN "recusadas" INTEGER NOT NULL DEFAULT 0;
