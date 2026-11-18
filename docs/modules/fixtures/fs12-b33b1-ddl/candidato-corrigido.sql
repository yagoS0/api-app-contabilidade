-- TEST FIXTURE ONLY: additive corrections after original.sql, not a production migration.
-- PostgreSQL verifies shape and bounds, never authenticity of the ciphertext or authority.
CREATE FUNCTION fs12_cifra_estrutura_valida(e JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(e) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 7
    OR NOT (e ?& ARRAY['v','alg','keyId','nonce','ciphertext','tag','aadVersion'])
    OR e->'v' IS DISTINCT FROM '1'::jsonb OR e->'aadVersion' IS DISTINCT FROM '1'::jsonb
    OR e->>'alg' IS DISTINCT FROM 'AES-256-GCM'
    OR jsonb_typeof(e->'keyId') IS DISTINCT FROM 'string'
    OR length(trim(e->>'keyId')) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(e->'nonce') IS DISTINCT FROM 'string'
    OR jsonb_typeof(e->'ciphertext') IS DISTINCT FROM 'string'
    OR jsonb_typeof(e->'tag') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  -- Bound encoded input before allocating decoded data. 16 MiB ciphertext == plaintext in GCM.
  IF length(e->>'nonce') <> 16 OR length(e->>'tag') <> 24
    OR length(e->>'ciphertext') > 22369624 THEN RETURN false; END IF;
  IF octet_length(decode(e->>'nonce','base64')) <> 12
    OR octet_length(decode(e->>'tag','base64')) <> 16
    OR octet_length(decode(e->>'ciphertext','base64')) > 16777216 THEN RETURN false; END IF;
  -- Canonical base64 prevents whitespace/alternate spellings from evading byte accounting.
  RETURN replace(encode(decode(e->>'nonce','base64'),'base64'),E'\n','') = e->>'nonce'
    AND replace(encode(decode(e->>'tag','base64'),'base64'),E'\n','') = e->>'tag'
    AND replace(encode(decode(e->>'ciphertext','base64'),'base64'),E'\n','') = e->>'ciphertext';
EXCEPTION WHEN invalid_parameter_value OR data_exception THEN RETURN false;
END;
$$;
ALTER TABLE fs12_comando_reservas ADD CONSTRAINT fs12_envelope_cifra_formato CHECK (fs12_cifra_estrutura_valida("envelopeCifrado"));
ALTER TABLE fs12_comando_respostas ADD CONSTRAINT fs12_resposta_cifra_formato CHECK (fs12_cifra_estrutura_valida("corpoCifrado"));

CREATE FUNCTION validar_fs12_resposta_cadeia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m RECORD; c RECORD; a RECORD; r RECORD;
BEGIN
  SELECT * INTO c FROM fs12_comandos WHERE id=NEW."comandoId";
  SELECT * INTO a FROM fs12_comando_reservas WHERE "comandoId"=NEW."comandoId" AND "reservaId"=NEW."reservaId";
  SELECT * INTO r FROM serpro_chamadas WHERE id=NEW."reservaId";
  SELECT * INTO m FROM "AppSetting" WHERE key=NEW."marcadorKey" FOR SHARE;
  IF c.id IS NULL OR a."comandoId" IS NULL OR r.id IS NULL OR m.key IS NULL
    OR jsonb_typeof(m.value) IS DISTINCT FROM 'object'
    OR m.value->>'reservaId' IS DISTINCT FROM NEW."reservaId"
    OR m.value->>'companyId' IS DISTINCT FROM c."portalClientId"
    OR jsonb_typeof(m.value->'authorizedAt') IS DISTINCT FROM 'string'
    OR length(trim(m.value->>'authorizedAt')) = 0
    OR NEW."marcadorObservado" IS DISTINCT FROM m.value
    OR r."portalClientId" IS DISTINCT FROM c."portalClientId"
    OR r.cnpj IS DISTINCT FROM c.cnpj OR r.competencia IS DISTINCT FROM c.competencia
    OR r."acaoId" IS DISTINCT FROM c.id OR r.assinatura IS DISTINCT FROM a.assinatura
    OR r.rota IS DISTINCT FROM a.rota OR r."idSistema" IS DISTINCT FROM a."idSistema"
    OR r."idServico" IS DISTINCT FROM a."idServico"
    OR r.status NOT IN ('reservada','ok','erro','incerta') THEN
    RAISE EXCEPTION 'FS12 response chain mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_resposta_cadeia_validar BEFORE INSERT ON fs12_comando_respostas
FOR EACH ROW EXECUTE FUNCTION validar_fs12_resposta_cadeia();
CREATE INDEX fs12_resposta_marcador_idx ON fs12_comando_respostas("marcadorKey");
CREATE INDEX fs12_comando_autor_idx ON fs12_comandos("autorId");
CREATE INDEX fs12_associacao_autor_idx ON fs12_comando_calculos("autorId");
CREATE INDEX fs12_associacao_resposta_idx ON fs12_comando_calculos("respostaId","comandoId");
-- TRUNCATE remains an owner/admin power. Future application grants MUST omit it.
-- Authentication, replay hash verification, AAD/tag verification and fiscal interpretation
-- belong to trusted capabilities; these SQL constraints do not implement the coordinator.
