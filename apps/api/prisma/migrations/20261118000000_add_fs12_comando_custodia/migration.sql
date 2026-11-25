-- Additive FS12 persistence, consolidated from the reviewed B3.3b.1 DDL.
-- No backfill, runtime grants, keys or fiscal dispatch. Prisma tracks application.
-- Whole migration is atomic; do not manually replay or conceal drift with IF NOT EXISTS.
BEGIN;

-- Proposta aditiva sobre evidência existente, sem alterar registros.
CREATE UNIQUE INDEX fs12_calculo_escopo_vinculo_key ON apuracao_fs12_calculos
  (id,"portalClientId","companyId",competencia,"revisaoFs12");
CREATE TABLE fs12_comandos (
  id TEXT PRIMARY KEY,
  "tentativaId" TEXT NOT NULL UNIQUE,
  "portalClientId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  cnpj TEXT NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  competencia TEXT NOT NULL CHECK (competencia ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  "revisaoFs12" INTEGER NOT NULL CHECK ("revisaoFs12" > 0),
  intencao TEXT NOT NULL CHECK (intencao IN ('SIMULAR','TRANSMITIR','RETIFICAR')),
  "vinculoOrigemId" TEXT,
  CHECK ((intencao = 'SIMULAR' AND "vinculoOrigemId" IS NULL)
    OR (intencao IN ('TRANSMITIR','RETIFICAR') AND "vinculoOrigemId" IS NOT NULL)),
  FOREIGN KEY ("vinculoOrigemId","portalClientId","companyId",competencia,"revisaoFs12")
    REFERENCES apuracao_fs12_calculos(id,"portalClientId","companyId",competencia,"revisaoFs12")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  "serieHash" TEXT NOT NULL CHECK ("serieHash" ~ '^[a-f0-9]{64}$'),
  "contextoHash" TEXT NOT NULL CHECK ("contextoHash" ~ '^[a-f0-9]{64}$'),
  "politicaVersao" TEXT NOT NULL,
  "chaveIdempotencia" TEXT NOT NULL CHECK ("chaveIdempotencia" ~ '^[a-zA-Z0-9_-]{16,100}$'),
  "comandoHash" TEXT NOT NULL CHECK ("comandoHash" ~ '^[a-f0-9]{64}$'),
  "hashVersao" TEXT NOT NULL CHECK ("hashVersao" = 'FS12_COMANDO_V1'),
  intencao_congelada JSONB NOT NULL CHECK (jsonb_typeof(intencao_congelada) = 'object'),
  esperado JSONB NOT NULL CHECK (jsonb_typeof(esperado) = 'object'),
  "autorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  origem TEXT NOT NULL CHECK (length(trim(origem)) BETWEEN 1 AND 200),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("portalClientId","companyId",competencia,"revisaoFs12")
    REFERENCES apuracao_fs12_revisoes("portalClientId","companyId",competencia,revisao)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  UNIQUE ("portalClientId",competencia,"chaveIdempotencia"),
  UNIQUE (id,"portalClientId","companyId",competencia,"revisaoFs12",intencao)
);
CREATE TABLE fs12_comando_reservas (
  "comandoId" TEXT PRIMARY KEY REFERENCES fs12_comandos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reservaId" TEXT NOT NULL UNIQUE REFERENCES serpro_chamadas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assinatura TEXT NOT NULL CHECK (assinatura ~ '^[a-f0-9]{64}$'),
  "envelopeCifrado" JSONB NOT NULL CHECK (jsonb_typeof("envelopeCifrado") = 'object'),
  "envelopeHash" TEXT NOT NULL CHECK ("envelopeHash" ~ '^[a-f0-9]{64}$'),
  rota TEXT NOT NULL CHECK (rota = '/Declarar'),
  "idSistema" TEXT NOT NULL CHECK ("idSistema" = 'PGDASD'),
  "idServico" TEXT NOT NULL CHECK ("idServico" = 'TRANSDECLARACAO11'),
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("comandoId","reservaId")
);
CREATE TABLE fs12_comando_respostas (
  id TEXT PRIMARY KEY,
  "comandoId" TEXT NOT NULL,
  "reservaId" TEXT NOT NULL,
  "marcadorKey" TEXT NOT NULL REFERENCES "AppSetting"(key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "httpStatus" INTEGER NOT NULL CHECK ("httpStatus" BETWEEN 100 AND 599),
  "corpoCifrado" JSONB NOT NULL CHECK (jsonb_typeof("corpoCifrado") = 'object'),
  "corpoHash" TEXT NOT NULL CHECK ("corpoHash" ~ '^[a-f0-9]{64}$'),
  "recebidoEm" TIMESTAMP(3) NOT NULL,
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "custodianteId" TEXT NOT NULL CHECK (length(trim("custodianteId")) BETWEEN 1 AND 200),
  "capacidadeId" TEXT NOT NULL CHECK (length(trim("capacidadeId")) BETWEEN 1 AND 200),
  "marcadorObservado" JSONB NOT NULL CHECK (jsonb_typeof("marcadorObservado") = 'object'),
  FOREIGN KEY ("comandoId","reservaId") REFERENCES fs12_comando_reservas("comandoId","reservaId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  UNIQUE (id,"comandoId"),
  UNIQUE ("comandoId","corpoHash","httpStatus"),
  CHECK ("marcadorKey" = 'serpro_dispatch:' || "reservaId")
);

CREATE TABLE fs12_comando_calculos (
  "comandoId" TEXT PRIMARY KEY,
  "respostaId" TEXT NOT NULL,
  FOREIGN KEY ("respostaId","comandoId") REFERENCES fs12_comando_respostas(id,"comandoId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  "vinculoId" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  competencia TEXT NOT NULL,
  "revisaoFs12" INTEGER NOT NULL,
  intencao TEXT NOT NULL CHECK (intencao IN ('SIMULAR','TRANSMITIR','RETIFICAR')),
  "autorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("comandoId","portalClientId","companyId",competencia,"revisaoFs12",intencao)
    REFERENCES fs12_comandos(id,"portalClientId","companyId",competencia,"revisaoFs12",intencao)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("vinculoId","portalClientId","companyId",competencia,"revisaoFs12")
    REFERENCES apuracao_fs12_calculos(id,"portalClientId","companyId",competencia,"revisaoFs12")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX fs12_calculo_unica_origem_simulacao ON fs12_comando_calculos("vinculoId")
  WHERE intencao = 'SIMULAR';
CREATE TRIGGER fs12_comando_imutavel BEFORE UPDATE OR DELETE ON fs12_comandos
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_reserva_imutavel BEFORE UPDATE OR DELETE ON fs12_comando_reservas
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_resposta_imutavel BEFORE UPDATE OR DELETE ON fs12_comando_respostas
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_associacao_imutavel BEFORE UPDATE OR DELETE ON fs12_comando_calculos
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();

CREATE FUNCTION validar_fs12_comando() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; p RECORD; c RECORD;
BEGIN
  SELECT * INTO r FROM apuracao_fs12_revisoes WHERE "portalClientId"=NEW."portalClientId"
    AND "companyId"=NEW."companyId" AND competencia=NEW.competencia AND revisao=NEW."revisaoFs12";
  SELECT * INTO p FROM "PortalClient" WHERE id=NEW."portalClientId";
  SELECT * INTO c FROM "Company" WHERE id=NEW."companyId";
  IF r.id IS NULL OR p.id IS NULL OR c.id IS NULL
    OR p."companyId" IS DISTINCT FROM NEW."companyId"
    OR regexp_replace(p.cnpj,'[^0-9]','','g') IS DISTINCT FROM NEW.cnpj
    OR regexp_replace(c.cnpj,'[^0-9]','','g') IS DISTINCT FROM NEW.cnpj
    OR r."contextoRevisao" IS DISTINCT FROM NEW."contextoHash"
    OR r."serieHash" IS DISTINCT FROM NEW."serieHash"
    OR r."politicaVersao" IS DISTINCT FROM NEW."politicaVersao" THEN
    RAISE EXCEPTION 'FS12 command identity mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_comando_validar BEFORE INSERT ON fs12_comandos
  FOR EACH ROW EXECUTE FUNCTION validar_fs12_comando();
CREATE FUNCTION validar_fs12_reserva() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; r RECORD;
BEGIN
  SELECT * INTO c FROM fs12_comandos WHERE id=NEW."comandoId";
  SELECT * INTO r FROM serpro_chamadas WHERE id=NEW."reservaId";
  IF c.id IS NULL OR r.id IS NULL OR r.status IS DISTINCT FROM 'reservada'
    OR r."portalClientId" IS DISTINCT FROM c."portalClientId" OR r.cnpj IS DISTINCT FROM c.cnpj
    OR r.competencia IS DISTINCT FROM c.competencia OR r."acaoId" IS DISTINCT FROM c.id
    OR r.assinatura IS DISTINCT FROM NEW.assinatura OR r.rota IS DISTINCT FROM NEW.rota
    OR r."idSistema" IS DISTINCT FROM NEW."idSistema" OR r."idServico" IS DISTINCT FROM NEW."idServico" THEN
    RAISE EXCEPTION 'FS12 reservation identity mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_reserva_validar BEFORE INSERT ON fs12_comando_reservas
  FOR EACH ROW EXECUTE FUNCTION validar_fs12_reserva();

CREATE FUNCTION validar_fs12_associacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM fs12_comandos WHERE id=NEW."comandoId";
  IF c.id IS NULL OR (c.intencao <> 'SIMULAR'
      AND NEW."vinculoId" IS DISTINCT FROM c."vinculoOrigemId") THEN
    RAISE EXCEPTION 'FS12 input calculation mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_associacao_validar BEFORE INSERT ON fs12_comando_calculos
  FOR EACH ROW EXECUTE FUNCTION validar_fs12_associacao();
CREATE INDEX fs12_comando_origem_idx ON fs12_comandos("vinculoOrigemId");
CREATE INDEX fs12_associacao_vinculo_idx ON fs12_comando_calculos("vinculoId");

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

COMMIT;
