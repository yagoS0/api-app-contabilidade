-- Additive B3.2 evidence only. No backfill, dispatch, or parallel state machine.
CREATE TABLE "apuracao_fs12_calculos" (
  "id" TEXT PRIMARY KEY,
  "portalClientId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "competencia" TEXT NOT NULL CHECK ("competencia" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  "calculoId" TEXT NOT NULL CHECK (length(trim("calculoId")) > 0),
  "revisaoFs12" INTEGER NOT NULL CHECK ("revisaoFs12" > 0),
  "contextoHash" TEXT NOT NULL CHECK ("contextoHash" ~ '^[a-f0-9]{64}$'),
  "politicaVersao" TEXT NOT NULL,
  "calculoConfirmado" JSONB NOT NULL CHECK (jsonb_typeof("calculoConfirmado") = 'object'),
  "calculoHash" TEXT NOT NULL CHECK ("calculoHash" ~ '^[a-f0-9]{64}$'),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("portalClientId", "companyId", "competencia", "revisaoFs12")
    REFERENCES "apuracao_fs12_revisoes"("portalClientId", "companyId", "competencia", "revisao") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "apuracao_fs12_calculos_calculoId_key" ON "apuracao_fs12_calculos"("calculoId");
CREATE INDEX "apuracao_fs12_calculos_portalClientId_companyId_competencia_idx" ON "apuracao_fs12_calculos"("portalClientId", "companyId", "competencia");

CREATE TABLE "apuracao_fs12_calculo_fatos" (
  "id" TEXT PRIMARY KEY,
  "vinculoId" TEXT NOT NULL REFERENCES "apuracao_fs12_calculos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "tentativaId" TEXT NOT NULL CHECK (length(trim("tentativaId")) BETWEEN 1 AND 200),
  "tipo" TEXT NOT NULL CHECK ("tipo" IN ('TENTATIVA_INICIADA', 'RESULTADO_CONFIRMADO', 'RESULTADO_INCERTO', 'RESULTADO_CONCILIADO', 'RECUSA_COMPROVADA')),
  "chaveIdempotencia" TEXT NOT NULL CHECK (length(trim("chaveIdempotencia")) BETWEEN 1 AND 200),
  "conteudoHash" TEXT NOT NULL CHECK ("conteudoHash" ~ '^[a-f0-9]{64}$'),
  "origem" TEXT NOT NULL CHECK (length(trim("origem")) BETWEEN 1 AND 200),
  "evidenciaReferencia" TEXT CHECK (length(trim("evidenciaReferencia")) BETWEEN 1 AND 200),
  "numeroDeclaracao" TEXT,
  "versaoDocumentoId" TEXT,
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("evidenciaReferencia" IS NOT NULL),
  CHECK (("tipo" IN ('RESULTADO_CONFIRMADO', 'RESULTADO_CONCILIADO') AND "numeroDeclaracao" IS NOT NULL AND length(trim("numeroDeclaracao")) > 0)
    OR ("tipo" NOT IN ('RESULTADO_CONFIRMADO', 'RESULTADO_CONCILIADO') AND "numeroDeclaracao" IS NULL AND "versaoDocumentoId" IS NULL))
);
CREATE UNIQUE INDEX "apuracao_fs12_calculo_fatos_vinculoId_chaveIdempotencia_key" ON "apuracao_fs12_calculo_fatos"("vinculoId", "chaveIdempotencia");
CREATE UNIQUE INDEX "apuracao_fs12_calculo_fatos_vinculoId_tentativaId_tipo_key" ON "apuracao_fs12_calculo_fatos"("vinculoId", "tentativaId", "tipo");

CREATE FUNCTION impedir_mutacao_fs12_calculo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FS12 calculation evidence is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER fs12_calculo_imutavel BEFORE UPDATE OR DELETE ON "apuracao_fs12_calculos"
FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_calculo_fato_imutavel BEFORE UPDATE OR DELETE ON "apuracao_fs12_calculo_fatos"
FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();

CREATE FUNCTION validar_insercao_fs12_calculo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM apuracao_fs12_revisoes WHERE "portalClientId" = NEW."portalClientId"
    AND "companyId" = NEW."companyId" AND competencia = NEW.competencia AND revisao = NEW."revisaoFs12";
  IF NOT FOUND OR r."contextoRevisao" IS DISTINCT FROM NEW."contextoHash" OR r."politicaVersao" IS DISTINCT FROM NEW."politicaVersao"
    OR NEW."calculoConfirmado"->>'calculoId' IS DISTINCT FROM NEW."calculoId"
    OR NEW."calculoConfirmado"->>'portalClientId' IS DISTINCT FROM NEW."portalClientId"
    OR NEW."calculoConfirmado"->>'competencia' IS DISTINCT FROM NEW.competencia
    OR NEW."calculoConfirmado"->'fs12'->>'revisaoId' IS DISTINCT FROM r.id
    OR NEW."calculoConfirmado"->'fs12'->>'revisao' IS DISTINCT FROM r.revisao::TEXT
    OR NEW."calculoConfirmado"->'fs12'->>'contextoHash' IS DISTINCT FROM NEW."contextoHash"
    OR NEW."calculoConfirmado"->'fs12'->>'politicaVersao' IS DISTINCT FROM NEW."politicaVersao"
    OR NEW."calculoConfirmado" ? 'numeroDeclaracao' THEN
    RAISE EXCEPTION 'FS12 calculation/revision identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_calculo_validar BEFORE INSERT ON "apuracao_fs12_calculos"
FOR EACH ROW EXECUTE FUNCTION validar_insercao_fs12_calculo();

CREATE FUNCTION validar_insercao_fs12_calculo_fato() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo <> 'TENTATIVA_INICIADA' AND NOT EXISTS (
    SELECT 1 FROM apuracao_fs12_calculo_fatos WHERE "vinculoId" = NEW."vinculoId"
      AND "tentativaId" = NEW."tentativaId" AND tipo = 'TENTATIVA_INICIADA') THEN
    RAISE EXCEPTION 'FS12 fiscal result requires its own calculation attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_calculo_fato_validar BEFORE INSERT ON "apuracao_fs12_calculo_fatos"
FOR EACH ROW EXECUTE FUNCTION validar_insercao_fs12_calculo_fato();
