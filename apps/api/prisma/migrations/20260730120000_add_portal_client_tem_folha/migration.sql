-- Empresa tem folha de pagamento (empregado registrado).
-- Distinto de "hasProlabore": sócio com pró-labore e nenhum empregado não gera eSocial/FGTS de folha.
-- Default false: nenhuma empresa existente passa a ser tratada como tendo folha por causa do deploy.
ALTER TABLE "PortalClient" ADD COLUMN     "temFolha" BOOLEAN NOT NULL DEFAULT false;
