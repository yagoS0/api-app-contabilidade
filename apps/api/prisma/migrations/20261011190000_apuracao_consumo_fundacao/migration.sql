-- CreateTable
CREATE TABLE "ApuracaoConsumoContribuinte" (
    "id" TEXT NOT NULL,
    "cnpjBase" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoConsumoContribuinte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApuracaoConsumoEstabelecimento" (
    "id" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoConsumoEstabelecimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApuracaoConsumoConfiguracao" (
    "id" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "tributo" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT false,
    "dados" JSONB NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoConsumoConfiguracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApuracaoConsumoRevisao" (
    "id" TEXT NOT NULL,
    "contribuinteId" TEXT NOT NULL,
    "tributo" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PREPARACAO',
    "configuracaoId" TEXT NOT NULL,
    "cadastroSnapshot" JSONB NOT NULL,
    "dados" JSONB NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApuracaoConsumoRevisao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApuracaoConsumoContribuinte_cnpjBase_key" ON "ApuracaoConsumoContribuinte"("cnpjBase");

-- CreateIndex
CREATE UNIQUE INDEX "ApuracaoConsumoEstabelecimento_portalClientId_key" ON "ApuracaoConsumoEstabelecimento"("portalClientId");

-- CreateIndex
CREATE INDEX "ApuracaoConsumoEstabelecimento_contribuinteId_idx" ON "ApuracaoConsumoEstabelecimento"("contribuinteId");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_config_versao_key" ON "ApuracaoConsumoConfiguracao"("contribuinteId", "tributo", "ambiente", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_config_intencao_key" ON "ApuracaoConsumoConfiguracao"("contribuinteId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_config_escopo_key" ON "ApuracaoConsumoConfiguracao"("id", "contribuinteId", "tributo", "ambiente");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_revisao_versao_key" ON "ApuracaoConsumoRevisao"("contribuinteId", "tributo", "ambiente", "competencia", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "consumo_revisao_intencao_key" ON "ApuracaoConsumoRevisao"("contribuinteId", "requestKey");

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoEstabelecimento" ADD CONSTRAINT "ApuracaoConsumoEstabelecimento_contribuinteId_fkey" FOREIGN KEY ("contribuinteId") REFERENCES "ApuracaoConsumoContribuinte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoEstabelecimento" ADD CONSTRAINT "ApuracaoConsumoEstabelecimento_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoConfiguracao" ADD CONSTRAINT "ApuracaoConsumoConfiguracao_contribuinteId_fkey" FOREIGN KEY ("contribuinteId") REFERENCES "ApuracaoConsumoContribuinte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoRevisao" ADD CONSTRAINT "ApuracaoConsumoRevisao_contribuinteId_fkey" FOREIGN KEY ("contribuinteId") REFERENCES "ApuracaoConsumoContribuinte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApuracaoConsumoRevisao" ADD CONSTRAINT "ApuracaoConsumoRevisao_configuracaoId_contribuinteId_tribu_fkey" FOREIGN KEY ("configuracaoId", "contribuinteId", "tributo", "ambiente") REFERENCES "ApuracaoConsumoConfiguracao"("id", "contribuinteId", "tributo", "ambiente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Formatos e domínio fechado desta etapa; não representam serviços oficiais ativos.
ALTER TABLE "ApuracaoConsumoContribuinte" ADD CONSTRAINT "consumo_cnpj_base_check" CHECK ("cnpjBase" ~ '^[A-Z0-9]{8}$');
ALTER TABLE "ApuracaoConsumoConfiguracao"
 ADD CONSTRAINT "consumo_config_tributo_check" CHECK ("tributo" IN ('CBS','IBS')),
 ADD CONSTRAINT "consumo_config_ambiente_check" CHECK ("ambiente" IN ('HOMOLOGACAO','PRODUCAO')),
 ADD CONSTRAINT "consumo_config_versao_check" CHECK ("versao" > 0),
 ADD CONSTRAINT "consumo_config_intencao_check" CHECK (length("requestKey") > 0 AND "requestHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ApuracaoConsumoRevisao"
 ADD CONSTRAINT "consumo_revisao_tributo_check" CHECK ("tributo" IN ('CBS','IBS')),
 ADD CONSTRAINT "consumo_revisao_ambiente_check" CHECK ("ambiente" IN ('HOMOLOGACAO','PRODUCAO')),
 ADD CONSTRAINT "consumo_revisao_competencia_check" CHECK ("competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 ADD CONSTRAINT "consumo_revisao_versao_check" CHECK ("versao" > 0),
 ADD CONSTRAINT "consumo_revisao_estado_check" CHECK ("estado" = 'PREPARACAO'),
 ADD CONSTRAINT "consumo_revisao_intencao_check" CHECK (length("requestKey") > 0 AND "requestHash" ~ '^[a-f0-9]{64}$');

CREATE FUNCTION consumo_fundacao_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Registro de fundação CBS/IBS imutável: %', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER consumo_contribuinte_imutavel BEFORE UPDATE OR DELETE ON "ApuracaoConsumoContribuinte" FOR EACH ROW EXECUTE FUNCTION consumo_fundacao_imutavel();
CREATE TRIGGER consumo_estabelecimento_imutavel BEFORE UPDATE OR DELETE ON "ApuracaoConsumoEstabelecimento" FOR EACH ROW EXECUTE FUNCTION consumo_fundacao_imutavel();
CREATE TRIGGER consumo_config_imutavel BEFORE UPDATE OR DELETE ON "ApuracaoConsumoConfiguracao" FOR EACH ROW EXECUTE FUNCTION consumo_fundacao_imutavel();
CREATE TRIGGER consumo_revisao_imutavel BEFORE UPDATE OR DELETE ON "ApuracaoConsumoRevisao" FOR EACH ROW EXECUTE FUNCTION consumo_fundacao_imutavel();

CREATE FUNCTION consumo_estabelecimento_validar_base() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base text; documento text;
BEGIN
 SELECT "cnpjBase" INTO base FROM "ApuracaoConsumoContribuinte" WHERE id = NEW."contribuinteId";
 SELECT upper(regexp_replace(cnpj, '[^a-zA-Z0-9]', '', 'g')) INTO documento FROM "PortalClient" WHERE id = NEW."portalClientId";
 IF base IS NULL OR documento IS NULL OR documento !~ '^[A-Z0-9]{12}[0-9]{2}$' OR left(documento, 8) <> base THEN
  RAISE EXCEPTION 'Estabelecimento não pertence ao CNPJ-base' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER consumo_estabelecimento_base BEFORE INSERT ON "ApuracaoConsumoEstabelecimento" FOR EACH ROW EXECUTE FUNCTION consumo_estabelecimento_validar_base();

CREATE FUNCTION consumo_empresa_preservar_base() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "ApuracaoConsumoEstabelecimento" e JOIN "ApuracaoConsumoContribuinte" c ON c.id = e."contribuinteId" WHERE e."portalClientId" = OLD.id AND (upper(regexp_replace(NEW.cnpj, '[^a-zA-Z0-9]', '', 'g')) !~ '^[A-Z0-9]{12}[0-9]{2}$' OR c."cnpjBase" <> left(upper(regexp_replace(NEW.cnpj, '[^a-zA-Z0-9]', '', 'g')), 8))) THEN
  RAISE EXCEPTION 'CNPJ incompatível com contribuinte CBS/IBS vinculado' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER consumo_empresa_base BEFORE UPDATE OF cnpj ON "PortalClient" FOR EACH ROW EXECUTE FUNCTION consumo_empresa_preservar_base();
