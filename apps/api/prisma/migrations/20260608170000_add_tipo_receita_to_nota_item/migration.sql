-- AlterTable
ALTER TABLE "nota_itens" ADD COLUMN     "classificadoEm" TIMESTAMP(3),
ADD COLUMN     "tipoReceita" "TipoReceita";

-- CreateIndex
CREATE INDEX "nota_itens_tipoReceita_idx" ON "nota_itens"("tipoReceita");

