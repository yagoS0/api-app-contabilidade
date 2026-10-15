-- Explicit owner-requested removal. Financial/fiscal document tables are not targets.
BEGIN;
LOCK TABLE "obrigacoes", "ocorrencias_obrigacao", "regras_obrigacao", "regras_obrigacao_excecoes", "tarefas_agenda", "agenda_ocultacoes", "calendario_legado_snapshots", "tarefas_calendario" IN SHARE ROW EXCLUSIVE MODE;
DELETE FROM "ocorrencias_obrigacao";
DELETE FROM "obrigacoes";
DELETE FROM "regras_obrigacao_excecoes";
DELETE FROM "regras_obrigacao";
DELETE FROM "tarefas_agenda";
DELETE FROM "agenda_ocultacoes";
DELETE FROM "calendario_legado_snapshots";
DELETE FROM "tarefas_calendario" WHERE "id" LIKE 'legado:%';

-- Retain empty table definitions for compatibility during rolling deployment.
-- Prevent an older API process, stale tab or worker from recreating removed records.
CREATE FUNCTION reject_legacy_calendar_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CALENDARIO_LEGADO_REMOVIDO' USING ERRCODE = '55000';
END;
$$;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['obrigacoes','ocorrencias_obrigacao','regras_obrigacao','regras_obrigacao_excecoes','tarefas_agenda','agenda_ocultacoes','calendario_legado_snapshots'] LOOP
    EXECUTE format('CREATE TRIGGER legacy_calendar_removed BEFORE INSERT OR UPDATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_legacy_calendar_write()', target);
  END LOOP;
END;
$$;
COMMIT;
