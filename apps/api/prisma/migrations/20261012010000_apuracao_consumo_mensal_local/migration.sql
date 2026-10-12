-- CreateTable
CREATE TABLE "ApuracaoConsumoMesLocal" (
    "id" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "tributo" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "acao" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "contextoSnapshot" JSONB NOT NULL,
    "comando" JSONB NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoConsumoMesLocal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApuracaoConsumoDocumentoLocal" (
    "id" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "tributo" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "referenciaHash" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoConsumoDocumentoLocal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consumo_mes_local_versao_key" ON "ApuracaoConsumoMesLocal"("contribuinteId", "tributo", "ambiente", "competencia", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_mes_local_intencao_key" ON "ApuracaoConsumoMesLocal"("contribuinteId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_doc_local_referencia_key" ON "ApuracaoConsumoDocumentoLocal"("contribuinteId", "tributo", "ambiente", "tipo", "referenciaHash");

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoMesLocal" ADD CONSTRAINT "ApuracaoConsumoMesLocal_contribuinteId_fkey" FOREIGN KEY ("contribuinteId") REFERENCES "ApuracaoConsumoContribuinte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoDocumentoLocal" ADD CONSTRAINT "ApuracaoConsumoDocumentoLocal_contribuinteId_fkey" FOREIGN KEY ("contribuinteId") REFERENCES "ApuracaoConsumoContribuinte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApuracaoConsumoMesLocal" ADD CONSTRAINT "consumo_mes_local_dominio" CHECK (
 "tributo" IN ('CBS','IBS') AND "ambiente" IN ('HOMOLOGACAO','PRODUCAO')
 AND "competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "versao" > 0
 AND "estado" IN ('EM_CONFERENCIA','CONFERIDA_LOCAL')
 AND "acao" IN ('REGISTRAR_BASE','RESOLVER_PENDENCIA','CONFERIR_LOCAL','REGISTRAR_GUIA','REGISTRAR_PAGAMENTO','ALOCAR','ESTORNAR_ALOCACAO','CANCELAR_GUIA','CANCELAR_PAGAMENTO')
 AND "requestHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("dados") = 'object' AND jsonb_typeof("contextoSnapshot") = 'object' AND jsonb_typeof("comando") = 'object'
);
ALTER TABLE "ApuracaoConsumoDocumentoLocal" ADD CONSTRAINT "consumo_doc_local_dominio" CHECK (
 "tributo" IN ('CBS','IBS') AND "ambiente" IN ('HOMOLOGACAO','PRODUCAO')
 AND "competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "tipo" IN ('GUIA','PAGAMENTO')
 AND "referenciaHash" ~ '^[a-f0-9]{64}$' AND length("referencia") BETWEEN 1 AND 200
);
CREATE FUNCTION consumo_mensal_local_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historico mensal local imutavel: registre nova intencao'; END $$;
CREATE TRIGGER consumo_mes_local_preservar BEFORE UPDATE OR DELETE ON "ApuracaoConsumoMesLocal"
 FOR EACH ROW EXECUTE FUNCTION consumo_mensal_local_imutavel();
CREATE TRIGGER consumo_doc_local_preservar BEFORE UPDATE OR DELETE ON "ApuracaoConsumoDocumentoLocal"
 FOR EACH ROW EXECUTE FUNCTION consumo_mensal_local_imutavel();
