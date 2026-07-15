-- CADASTRO: campos da ficha do escritório. Tudo aditivo (colunas nullable / com default).

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "abriuCom" TEXT,
ADD COLUMN     "alteracaoData" TIMESTAMP(3),
ADD COLUMN     "alteracaoNumero" TEXT,
ADD COLUMN     "desoneracao" BOOLEAN DEFAULT false,
ADD COLUMN     "diarioNumero" TEXT,
ADD COLUMN     "inscricaoEstadual" TEXT,
ADD COLUMN     "inscricaoEstadualData" TIMESTAMP(3),
ADD COLUMN     "inscricaoMunicipalData" TIMESTAMP(3),
ADD COLUMN     "naturezaJuridica" TEXT,
ADD COLUMN     "numeroRegistro" TEXT,
ADD COLUMN     "tipoRegistro" TEXT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "dataNascimento" TIMESTAMP(3),
ADD COLUMN     "dataSaida" TIMESTAMP(3),
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "rgOrgaoEmissor" TEXT;

-- CreateTable
CREATE TABLE "regime_historico" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "impostos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desoneracao" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regime_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regime_historico_companyId_vigenciaInicio_idx" ON "regime_historico"("companyId", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "Partner_companyId_idx" ON "Partner"("companyId");

-- AddForeignKey
ALTER TABLE "regime_historico" ADD CONSTRAINT "regime_historico_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;