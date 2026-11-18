-- TEST FIXTURE ONLY. Exact DDL from integrated B3.3b.1 section 3; never a production migration.
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
