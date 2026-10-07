CREATE TABLE "parcelamento_debitos_origem" (
 "id" TEXT NOT NULL PRIMARY KEY, "portalClientId" TEXT NOT NULL,
 "parcelamentoId" TEXT NOT NULL REFERENCES "parcelamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "origemChave" TEXT NOT NULL UNIQUE,
 "entryId" TEXT REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "guideId" TEXT REFERENCES "Guide"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "tributo" TEXT NOT NULL, "competencia" TEXT NOT NULL,
 "principalIncluido" DECIMAL(18,2) NOT NULL CHECK ("principalIncluido" > 0),
 "snapshot" JSONB NOT NULL, "criadoPorId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "origem_persistida" CHECK ("entryId" IS NOT NULL OR "guideId" IS NOT NULL)
);
CREATE INDEX "parcelamento_debitos_origem_empresa_acordo_idx" ON "parcelamento_debitos_origem" ("portalClientId","parcelamentoId");

-- Backstop comum a rotas, importações e trabalhadores. A mesma trava é usada
-- antes de conferir o saldo na composição; desligar a interface não remove a proteção.
CREATE FUNCTION conferir_origem_parcelada(empresa TEXT, entrada TEXT, aberta TEXT, guia TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('origens-parcelamento:' || empresa));
 IF EXISTS (SELECT 1 FROM parcelamento_debitos_origem o
            WHERE o."portalClientId" = empresa
              AND (o."entryId" IN (entrada, aberta)
                   OR (o."entryId" IS NULL AND o."guideId" = guia))) THEN
   RAISE EXCEPTION 'DIVIDA_PARCELADA: confira a composição do acordo antes de alterar ou baixar esta obrigação.' USING ERRCODE = '23514';
 END IF;
END $$;

CREATE FUNCTION proteger_lancamento_origem_parcelada() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e accounting_entries%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN
   e := OLD;
   PERFORM conferir_origem_parcelada(e."portalClientId", e.id, e."openEntryId", e."sourceGuideId");
 END IF;
 IF TG_OP <> 'DELETE' THEN
   e := NEW;
   PERFORM conferir_origem_parcelada(e."portalClientId", e.id, e."openEntryId", e."sourceGuideId");
   IF e."estornoDeEntryId" IS NOT NULL THEN
     SELECT * INTO e FROM accounting_entries WHERE id = NEW."estornoDeEntryId";
     PERFORM conferir_origem_parcelada(e."portalClientId", e.id, e."openEntryId", e."sourceGuideId");
   END IF;
   RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER proteger_origem_entrada_ins_del BEFORE INSERT OR DELETE ON accounting_entries
FOR EACH ROW EXECUTE FUNCTION proteger_lancamento_origem_parcelada();
CREATE TRIGGER proteger_origem_entrada_update BEFORE UPDATE OF "portalClientId", "sourceGuideId", "openEntryId", "tipo", "subtipo", "competencia", "data", "statusPagamento", "parcelamentoId", "estornoDeEntryId" ON accounting_entries
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION proteger_lancamento_origem_parcelada();

CREATE FUNCTION proteger_linha_origem_parcelada() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e accounting_entries%ROWTYPE; id_antigo TEXT; id_novo TEXT;
BEGIN
 IF TG_OP <> 'INSERT' THEN id_antigo := OLD."entryId"; END IF;
 IF TG_OP <> 'DELETE' THEN id_novo := NEW."entryId"; END IF;
 FOR e IN SELECT * FROM accounting_entries WHERE id IN (id_antigo, id_novo) ORDER BY id LOOP
   PERFORM conferir_origem_parcelada(e."portalClientId", e.id, e."openEntryId", e."sourceGuideId");
 END LOOP;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proteger_origem_linhas BEFORE INSERT OR UPDATE OR DELETE ON accounting_entry_lines
FOR EACH ROW EXECUTE FUNCTION proteger_linha_origem_parcelada();

CREATE FUNCTION proteger_guia_origem_parcelada() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM conferir_origem_parcelada(OLD."portalClientId", NULL, NULL, OLD.id);
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proteger_origem_guia_delete BEFORE DELETE ON "Guide"
FOR EACH ROW EXECUTE FUNCTION proteger_guia_origem_parcelada();
CREATE TRIGGER proteger_origem_guia_update BEFORE UPDATE OF "portalClientId", "tipo", "competencia", "parcelamentoId", "baixada", "lancamentoId" ON "Guide"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION proteger_guia_origem_parcelada();
