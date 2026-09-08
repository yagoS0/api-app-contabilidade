
ALTER TABLE "onboardings" ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "faseComercial" TEXT NOT NULL DEFAULT 'LEAD', ADD COLUMN "proposta" JSONB;
CREATE TABLE "onboarding_analises" ("id" TEXT PRIMARY KEY, "onboardingId" TEXT NOT NULL REFERENCES "onboardings"("id") ON DELETE CASCADE, "tipo" TEXT NOT NULL, "status" TEXT NOT NULL, "cnpj" TEXT NOT NULL, "resultado" JSONB NOT NULL DEFAULT '{}', "documentoCifrado" TEXT, "criadoPorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "onboarding_analises_onboardingId_createdAt_idx" ON "onboarding_analises"("onboardingId", "createdAt");
CREATE UNIQUE INDEX "onboarding_analise_em_execucao" ON "onboarding_analises"("onboardingId", "tipo") WHERE "status" = 'CONSULTANDO';
CREATE TABLE "onboarding_eventos" ("id" TEXT PRIMARY KEY, "onboardingId" TEXT NOT NULL REFERENCES "onboardings"("id") ON DELETE CASCADE, "tipo" TEXT NOT NULL, "dados" JSONB NOT NULL DEFAULT '{}', "atorId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "onboarding_eventos_onboardingId_createdAt_idx" ON "onboarding_eventos"("onboardingId", "createdAt");
CREATE TABLE "onboarding_links" ("id" TEXT PRIMARY KEY, "onboardingId" TEXT NOT NULL REFERENCES "onboardings"("id") ON DELETE CASCADE, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "submittedAt" TIMESTAMP(3), "criadoPorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "onboarding_links_onboardingId_idx" ON "onboarding_links"("onboardingId");
CREATE INDEX "onboardings_criadoPorId_idx" ON "onboardings"("criadoPorId");
ALTER TABLE "onboardings" ADD CONSTRAINT "onboarding_fase_comercial" CHECK ("faseComercial" IN ('LEAD','ANALISE','PROPOSTA','CONTRATADO'));
ALTER TABLE "onboarding_analises" ADD CONSTRAINT "onboarding_analise_tipo" CHECK ("tipo" IN ('PUBLICA','SITFIS')), ADD CONSTRAINT "onboarding_analise_status" CHECK ("status" IN ('CONSULTANDO','CONCLUIDA','PROCESSANDO','BLOQUEADA','FALHOU'));
CREATE UNIQUE INDEX "onboarding_um_link_ativo" ON "onboarding_links"("onboardingId") WHERE "revokedAt" IS NULL AND "submittedAt" IS NULL;
