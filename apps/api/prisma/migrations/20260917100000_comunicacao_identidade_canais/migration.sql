-- Aditiva: preserva IDs, mensagens, contratos e permissões. O backfill explícito fica no script.
CREATE TABLE "interlocutores_comunicacao" (
  "id" TEXT PRIMARY KEY, "tipo" TEXT NOT NULL DEFAULT 'NAO_VERIFICADO', "nome" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'ATIVO', "versao" INTEGER NOT NULL DEFAULT 1,
  "atendidaPor" TEXT, "atendidaDesde" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "interlocutor_tipo" CHECK ("tipo" IN ('PESSOA','COMPARTILHADO','NAO_VERIFICADO')),
  CONSTRAINT "interlocutor_estado" CHECK ("estado" IN ('ATIVO','EM_REVISAO'))
);
CREATE TABLE "vinculos_numero_interlocutor" (
  "id" TEXT PRIMARY KEY, "interlocutorId" TEXT NOT NULL REFERENCES "interlocutores_comunicacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "telefoneE164" TEXT NOT NULL, "iniciouEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "encerrouEm" TIMESTAMP(3),
  "geracao" INTEGER NOT NULL DEFAULT 1, "origem" TEXT NOT NULL DEFAULT 'MENSAGEM_RECEBIDA',
  "verificadoEm" TIMESTAMP(3), "verificadoPor" TEXT, "evidencia" TEXT,
  CONSTRAINT "vinculo_numero_vigencia" CHECK ("encerrouEm" IS NULL OR "encerrouEm" >= "iniciouEm")
);
CREATE UNIQUE INDEX "vinculos_numero_interlocutor_telefoneE164_geracao_key" ON "vinculos_numero_interlocutor"("telefoneE164","geracao");
CREATE UNIQUE INDEX "vinculo_numero_vigente" ON "vinculos_numero_interlocutor"("telefoneE164") WHERE "encerrouEm" IS NULL;
CREATE INDEX "vinculos_numero_interlocutor_interlocutorId_idx" ON "vinculos_numero_interlocutor"("interlocutorId");
CREATE TABLE "canais_whatsapp" (
  "id" TEXT PRIMARY KEY, "chave" TEXT NOT NULL, "finalidade" TEXT NOT NULL DEFAULT 'PRINCIPAL',
  "phoneNumberId" TEXT, "wabaId" TEXT, "referenciaCredencial" TEXT, "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "canais_whatsapp_chave_key" ON "canais_whatsapp"("chave");
CREATE UNIQUE INDEX "canais_whatsapp_phoneNumberId_key" ON "canais_whatsapp"("phoneNumberId");
INSERT INTO "canais_whatsapp" ("id","chave","updatedAt") VALUES ('principal','principal',CURRENT_TIMESTAMP);
ALTER TABLE "contatos_whatsapp" ADD COLUMN "vinculoNumeroId" TEXT REFERENCES "vinculos_numero_interlocutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversas_whatsapp" ADD COLUMN "canalId" TEXT REFERENCES "canais_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "vinculoNumeroId" TEXT REFERENCES "vinculos_numero_interlocutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "atendimentos_responsaveis_whatsapp" ADD COLUMN "canalId" TEXT REFERENCES "canais_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "vinculoNumeroId" TEXT REFERENCES "vinculos_numero_interlocutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envios_guia_tentativas" ADD COLUMN "canalId" TEXT REFERENCES "canais_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "atendimentos_responsaveis_whatsapp_canalId_vinculoNumeroId_key" ON "atendimentos_responsaveis_whatsapp"("canalId","vinculoNumeroId");
CREATE INDEX "conversas_identidade_canal" ON "conversas_whatsapp"("vinculoNumeroId","canalId","updatedAt");
CREATE INDEX "contatos_identidade" ON "contatos_whatsapp"("vinculoNumeroId");
ALTER TABLE "atendimentos_lead" ADD COLUMN "interlocutorId" TEXT REFERENCES "interlocutores_comunicacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "atendimento_lead_ativo_interlocutor" ON "atendimentos_lead"("interlocutorId") WHERE "encerradoEm" IS NULL AND "interlocutorId" IS NOT NULL;
CREATE TABLE "notas_internas_atendimento" (
  "id" TEXT PRIMARY KEY, "interlocutorId" TEXT NOT NULL REFERENCES "interlocutores_comunicacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "autorId" TEXT NOT NULL, "autorNome" TEXT NOT NULL, "texto" TEXT NOT NULL, "escopo" TEXT NOT NULL,
  "portalClientId" TEXT, "atendimentoLeadId" TEXT REFERENCES "atendimentos_lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "chaveIdempotencia" TEXT NOT NULL, "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nota_escopo_coerente" CHECK (("escopo"='PESSOA' AND "portalClientId" IS NULL AND "atendimentoLeadId" IS NULL)
    OR ("escopo"='EMPRESA' AND "portalClientId" IS NOT NULL AND "atendimentoLeadId" IS NULL)
    OR ("escopo"='CASO' AND "atendimentoLeadId" IS NOT NULL AND "portalClientId" IS NULL))
);
CREATE UNIQUE INDEX "notas_internas_atendimento_interlocutorId_chaveIdempotencia_key" ON "notas_internas_atendimento"("interlocutorId","chaveIdempotencia");
CREATE INDEX "notas_internas_atendimento_interlocutorId_criadaEm_idx" ON "notas_internas_atendimento"("interlocutorId","criadaEm");
CREATE TABLE "eventos_identidade_comunicacao" (
  "id" TEXT PRIMARY KEY, "interlocutorId" TEXT NOT NULL, "vinculoNumeroId" TEXT NOT NULL, "versaoAnterior" INTEGER NOT NULL,
  "acao" TEXT NOT NULL, "atorId" TEXT NOT NULL, "evidencia" TEXT NOT NULL, "dados" JSONB NOT NULL,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "eventos_identidade_comunicacao_interlocutorId_criadaEm_idx" ON "eventos_identidade_comunicacao"("interlocutorId","criadaEm");
CREATE TABLE "coletas_comerciais_whatsapp" (
  "mensagemId" TEXT PRIMARY KEY, "atendimentoLeadId" TEXT NOT NULL REFERENCES "atendimentos_lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resultado" JSONB NOT NULL, "identidadeVersao" INTEGER NOT NULL, "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "fichas_empresa_avulsa" (
  "id" TEXT PRIMARY KEY, "onboardingId" TEXT NOT NULL REFERENCES "onboardings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cnpj" TEXT, "dados" JSONB NOT NULL, "versao" INTEGER NOT NULL DEFAULT 1, "criadoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "fichas_empresa_avulsa_onboardingId_key" ON "fichas_empresa_avulsa"("onboardingId");
CREATE INDEX "fichas_empresa_avulsa_cnpj_idx" ON "fichas_empresa_avulsa"("cnpj");
CREATE TABLE "documentos_ficha_avulsa" (
  "id" TEXT PRIMARY KEY, "fichaId" TEXT NOT NULL REFERENCES "fichas_empresa_avulsa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "nome" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "fileKey" TEXT NOT NULL, "bytes" INTEGER NOT NULL,
  "sha256" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "documentos_ficha_avulsa_fichaId_idx" ON "documentos_ficha_avulsa"("fichaId");
