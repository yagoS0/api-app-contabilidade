-- Additive only. No backfill; no calculation/DP/accounting association.
CREATE TABLE "apuracao_fs12_revisoes" (
  "id" TEXT PRIMARY KEY,
  "portalClientId" TEXT NOT NULL REFERENCES "PortalClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "competencia" TEXT NOT NULL CHECK ("competencia" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  "revisao" INTEGER NOT NULL CHECK ("revisao" > 0),
  "serie" JSONB NOT NULL CHECK (jsonb_typeof("serie") = 'array' AND jsonb_array_length("serie") BETWEEN 1 AND 12),
  "politicaVersao" TEXT NOT NULL,
  "contexto" JSONB NOT NULL,
  "contextoRevisao" TEXT NOT NULL CHECK ("contextoRevisao" ~ '^[a-f0-9]{64}$'),
  "serieHash" TEXT NOT NULL CHECK ("serieHash" ~ '^[a-f0-9]{64}$'),
  "comandoHash" TEXT NOT NULL CHECK ("comandoHash" ~ '^[a-f0-9]{64}$'),
  "autorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "chaveIdempotencia" TEXT NOT NULL CHECK ("chaveIdempotencia" ~ '^[a-zA-Z0-9_-]{16,100}$'),
  "motivo" TEXT,
  CHECK ("revisao" = 1 OR ("motivo" IS NOT NULL AND length(trim("motivo")) BETWEEN 1 AND 1000))
);
CREATE UNIQUE INDEX "fs12_apuracao_revisao_key" ON "apuracao_fs12_revisoes"("portalClientId", "companyId", "competencia", "revisao");
CREATE UNIQUE INDEX "fs12_apuracao_idempotencia_key" ON "apuracao_fs12_revisoes"("portalClientId", "competencia", "chaveIdempotencia");
CREATE INDEX "fs12_apuracao_escopo_revisao_idx" ON "apuracao_fs12_revisoes"("portalClientId", "companyId", "competencia", "revisao");

-- Revisions are evidence, including when application code is rolled back.
CREATE FUNCTION impedir_mutacao_apuracao_fs12() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FS12 revisions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER apuracao_fs12_imutavel BEFORE UPDATE OR DELETE ON "apuracao_fs12_revisoes"
FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_apuracao_fs12();

-- Reject malformed evidence even through direct SQL. The B1 window is checked by the use case.
CREATE FUNCTION validar_insercao_apuracao_fs12() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB; anterior TEXT := ''; total NUMERIC := 0; valor NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PortalClient" WHERE id = NEW."portalClientId" AND "companyId" = NEW."companyId") THEN
    RAISE EXCEPTION 'FS12 company identity mismatch' USING ERRCODE = '23514';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.serie) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'mes') IS DISTINCT FROM 'string'
      OR (item->>'mes') !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
      OR (item->>'mes') <= anterior
      OR jsonb_typeof(item->'valorCentavos') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'FS12 invalid ordered series' USING ERRCODE = '23514';
    END IF;
    valor := (item->>'valorCentavos')::NUMERIC;
    total := total + valor;
    IF valor < 0 OR trunc(valor) <> valor OR total > 9007199254740991 THEN
      RAISE EXCEPTION 'FS12 unsafe amount' USING ERRCODE = '23514';
    END IF;
    anterior := item->>'mes';
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER apuracao_fs12_validar BEFORE INSERT ON "apuracao_fs12_revisoes"
FOR EACH ROW EXECUTE FUNCTION validar_insercao_apuracao_fs12();
