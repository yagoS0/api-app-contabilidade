-- Q20: filtro de notas por atividade (CFOP / código de serviço LC116).
-- Índices pra o filtro indexado/paginado em GET /notas (subquery por NotaItem).
CREATE INDEX "nota_itens_cfop_idx" ON "nota_itens"("cfop");
CREATE INDEX "nota_itens_codigoServico_idx" ON "nota_itens"("codigoServico");
