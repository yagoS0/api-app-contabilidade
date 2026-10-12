-- CreateTable
CREATE TABLE "ApuracaoCbsColeta" (
    "id" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "tributo" TEXT NOT NULL DEFAULT 'CBS',
    "ambiente" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "configuracaoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'RESERVADA',
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "ticket" TEXT,
    "etaSegundos" TEXT,
    "arquivoExpiraEm" TIMESTAMP(3),
    "dadosDownloadCifrados" BYTEA,
    "operacaoEmCursoId" TEXT,
    "erroCodigo" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApuracaoCbsColeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApuracaoCbsTentativa" (
    "id" TEXT NOT NULL,
    "coletaId" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'RESERVADA',
    "evidenciaCifrada" BYTEA,
    "erroCodigo" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadaEm" TIMESTAMP(3),

    CONSTRAINT "ApuracaoCbsTentativa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApuracaoCbsArquivo" (
    "id" TEXT NOT NULL,
    "coletaId" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "conteudoCifrado" BYTEA NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoCbsArquivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cbs_coleta_contexto_idx" ON "ApuracaoCbsColeta"("contribuinteId", "ambiente", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cbs_coleta_intencao_key" ON "ApuracaoCbsColeta"("contribuinteId", "requestKey");
CREATE UNIQUE INDEX "cbs_coleta_ticket_key" ON "ApuracaoCbsColeta"("contribuinteId", "ambiente", "ticket");

-- Estados técnicos não representam apuração conferida. Restrições locais conservadoras.
ALTER TABLE "ApuracaoCbsColeta" ADD CONSTRAINT "cbs_coleta_dominios" CHECK (
  "tributo" = 'CBS' AND "ambiente" IN ('HOMOLOGACAO','PRODUCAO') AND "recurso" IN ('DEBITOS','CREDITOS')
  AND "estado" IN ('RESERVADA','INCERTA','PENDENTE','EM_PROCESSAMENTO','DISPONIVEL','ARQUIVADA','ERRO','EXPIRADA')
  AND ("etaSegundos" IS NULL OR "etaSegundos" ~ '^[0-9]+$')
  AND ("estado" NOT IN ('DISPONIVEL','ARQUIVADA') OR "ticket" IS NOT NULL)
  AND ("estado" <> 'DISPONIVEL' OR ("dadosDownloadCifrados" IS NOT NULL AND "arquivoExpiraEm" IS NOT NULL))
  AND ("estado" NOT IN ('ARQUIVADA','EXPIRADA') OR "dadosDownloadCifrados" IS NULL)
);
CREATE UNIQUE INDEX "cbs_coleta_aberta_key" ON "ApuracaoCbsColeta" ("contribuinteId","ambiente","recurso")
  WHERE "estado" IN ('RESERVADA','INCERTA','PENDENTE','EM_PROCESSAMENTO','DISPONIVEL');
ALTER TABLE "ApuracaoCbsTentativa" ADD CONSTRAINT "cbs_tentativa_dominios" CHECK (
  "ambiente" IN ('HOMOLOGACAO','PRODUCAO') AND "operacao" IN ('ABRIR','CONSULTAR','BAIXAR')
  AND "estado" IN ('RESERVADA','CONCLUIDA','INCERTA','ERRO')
  AND (("estado" = 'RESERVADA' AND "finalizadaEm" IS NULL) OR ("estado" <> 'RESERVADA' AND "finalizadaEm" IS NOT NULL))
);
ALTER TABLE "ApuracaoCbsArquivo" ADD CONSTRAINT "cbs_arquivo_dominios" CHECK (
  "ambiente" IN ('HOMOLOGACAO','PRODUCAO') AND "sha256" ~ '^[0-9a-f]{64}$'
  AND "tamanhoBytes" BETWEEN 1 AND 10485760 AND octet_length("conteudoCifrado") = "tamanhoBytes" + 29
);

CREATE FUNCTION cbs_proteger_evidencia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'ApuracaoCbsArquivo' THEN
    RAISE EXCEPTION 'CBS evidencia imutavel';
  END IF;
  IF TG_TABLE_NAME = 'ApuracaoCbsTentativa' THEN
    IF OLD."estado" <> 'RESERVADA' OR
      (to_jsonb(NEW) - ARRAY['estado','evidenciaCifrada','erroCodigo','finalizadaEm']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['estado','evidenciaCifrada','erroCodigo','finalizadaEm']) THEN
      RAISE EXCEPTION 'CBS tentativa imutavel';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['estado','ticket','etaSegundos','arquivoExpiraEm','dadosDownloadCifrados','operacaoEmCursoId','erroCodigo','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['estado','ticket','etaSegundos','arquivoExpiraEm','dadosDownloadCifrados','operacaoEmCursoId','erroCodigo','updatedAt']) THEN
      RAISE EXCEPTION 'CBS identidade imutavel';
    END IF;
    IF OLD."ticket" IS NOT NULL AND NEW."ticket" IS DISTINCT FROM OLD."ticket" THEN
      RAISE EXCEPTION 'CBS tiquete imutavel';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cbs_coleta_preservar BEFORE UPDATE OR DELETE ON "ApuracaoCbsColeta" FOR EACH ROW EXECUTE FUNCTION cbs_proteger_evidencia();
CREATE TRIGGER cbs_tentativa_preservar BEFORE UPDATE OR DELETE ON "ApuracaoCbsTentativa" FOR EACH ROW EXECUTE FUNCTION cbs_proteger_evidencia();
CREATE TRIGGER cbs_arquivo_preservar BEFORE UPDATE OR DELETE ON "ApuracaoCbsArquivo" FOR EACH ROW EXECUTE FUNCTION cbs_proteger_evidencia();

-- CreateIndex
CREATE UNIQUE INDEX "cbs_coleta_escopo_key" ON "ApuracaoCbsColeta"("id", "contribuinteId", "ambiente");

-- CreateIndex
CREATE INDEX "cbs_tentativa_coleta_idx" ON "ApuracaoCbsTentativa"("coletaId", "iniciadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "cbs_tentativa_intencao_key" ON "ApuracaoCbsTentativa"("contribuinteId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApuracaoCbsArquivo_coletaId_key" ON "ApuracaoCbsArquivo"("coletaId");

-- CreateIndex
CREATE INDEX "cbs_arquivo_hash_idx" ON "ApuracaoCbsArquivo"("contribuinteId", "ambiente", "sha256");

-- AddForeignKey
ALTER TABLE "ApuracaoCbsColeta" ADD CONSTRAINT "ApuracaoCbsColeta_contribuinteId_fkey" FOREIGN KEY ("contribuinteId") REFERENCES "ApuracaoConsumoContribuinte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoCbsColeta" ADD CONSTRAINT "ApuracaoCbsColeta_configuracaoId_contribuinteId_tributo_am_fkey" FOREIGN KEY ("configuracaoId", "contribuinteId", "tributo", "ambiente") REFERENCES "ApuracaoConsumoConfiguracao"("id", "contribuinteId", "tributo", "ambiente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoCbsTentativa" ADD CONSTRAINT "ApuracaoCbsTentativa_coletaId_contribuinteId_ambiente_fkey" FOREIGN KEY ("coletaId", "contribuinteId", "ambiente") REFERENCES "ApuracaoCbsColeta"("id", "contribuinteId", "ambiente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoCbsArquivo" ADD CONSTRAINT "ApuracaoCbsArquivo_coletaId_contribuinteId_ambiente_fkey" FOREIGN KEY ("coletaId", "contribuinteId", "ambiente") REFERENCES "ApuracaoCbsColeta"("id", "contribuinteId", "ambiente") ON DELETE RESTRICT ON UPDATE CASCADE;
