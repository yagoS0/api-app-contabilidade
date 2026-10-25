-- Additive S1 contract. Legacy producers remain unchanged until S2.
ALTER TABLE "encaminhamentos_suporte"
  ALTER COLUMN "conversaId" DROP NOT NULL,
  ALTER COLUMN "mensagemId" DROP NOT NULL,
  ADD COLUMN "contratoVersao" INTEGER,
  ADD COLUMN "revisao" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "portalClientId" TEXT,
  ADD COLUMN "titulo" TEXT,
  ADD COLUMN "prioridade" TEXT,
  ADD COLUMN "prazoCivil" VARCHAR(10),
  ADD COLUMN "origem" TEXT,
  ADD COLUMN "criadorId" TEXT,
  ADD COLUMN "concluidoPorId" TEXT,
  ADD COLUMN "concluidoEm" TIMESTAMP(3),
  ADD COLUMN "observacaoConclusao" TEXT,
  ADD COLUMN "anotacaoId" TEXT;

-- Retain the legacy validation before replacing its original global form.
-- Only explicitly new-contract rows may carry independent subjects in one chat.
CREATE UNIQUE INDEX "encaminhamento_ativo_conversa_legado" ON "encaminhamentos_suporte"("conversaId")
  WHERE estado <> 'RESOLVIDO' AND "contratoVersao" IS NULL;
DROP INDEX "encaminhamento_ativo_conversa";
ALTER TABLE "encaminhamentos_suporte" ADD CONSTRAINT "solicitacao_estado_compativel"
  CHECK (estado IN ('AGUARDANDO','EM_ATENDIMENTO','RESOLVIDO') OR
    ("contratoVersao" IS NOT NULL AND "contratoVersao" = 1 AND estado = 'AGUARDANDO_CLIENTE'));
ALTER TABLE "encaminhamentos_suporte" DROP CONSTRAINT "encaminhamento_estado";

-- Only the recorded conversation relation proves the operational company.
-- Do not touch state, authorship, resolution dates, text, or updatedAt.
UPDATE "encaminhamentos_suporte" s
SET "portalClientId" = c."portalClientId"
FROM "conversas_whatsapp" c
WHERE s."conversaId" = c.id AND c."portalClientId" IS NOT NULL;

ALTER TABLE "encaminhamentos_suporte"
  ADD CONSTRAINT "encaminhamentos_suporte_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "encaminhamentos_suporte_anotacaoId_fkey" FOREIGN KEY ("anotacaoId") REFERENCES "company_notes"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "solicitacao_contrato_valido" CHECK ("contratoVersao" IS NULL OR "contratoVersao" = 1),
  ADD CONSTRAINT "solicitacao_origem_legada_obrigatoria" CHECK (
    ("contratoVersao" IS NOT NULL AND "contratoVersao" = 1) OR ("conversaId" IS NOT NULL AND "mensagemId" IS NOT NULL)
  ),
  ADD CONSTRAINT "solicitacao_revisao_valida" CHECK (revisao >= 0),
  ADD CONSTRAINT "solicitacao_prioridade_valida" CHECK (prioridade IS NULL OR prioridade IN ('ALTA','MEDIA','BAIXA')),
  ADD CONSTRAINT "solicitacao_prazo_valido" CHECK ("prazoCivil" IS NULL OR (
    "prazoCivil" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char("prazoCivil"::date, 'YYYY-MM-DD') = "prazoCivil"
  ));

CREATE INDEX "solicitacao_empresa_estado_data" ON "encaminhamentos_suporte" ("portalClientId", estado, "createdAt", id);
CREATE INDEX "solicitacao_prazo_estado" ON "encaminhamentos_suporte" ("prazoCivil", estado);
CREATE INDEX "solicitacao_conversa_estado" ON "encaminhamentos_suporte" ("conversaId", estado);

CREATE TABLE "solicitacoes_eventos" (
  id TEXT PRIMARY KEY, "solicitacaoId" TEXT NOT NULL, revisao INTEGER NOT NULL,
  tipo TEXT NOT NULL, "atorId" TEXT NOT NULL, "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  antes JSONB, depois JSONB NOT NULL,
  CONSTRAINT "solicitacoes_eventos_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "encaminhamentos_suporte"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "solicitacoes_eventos_solicitacaoId_revisao_key" ON "solicitacoes_eventos" ("solicitacaoId", revisao);
CREATE TABLE "solicitacoes_comandos" (
  id TEXT PRIMARY KEY, "atorId" TEXT NOT NULL, chave TEXT NOT NULL, fingerprint TEXT NOT NULL,
  "solicitacaoId" TEXT NOT NULL, resultado JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solicitacoes_comandos_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "encaminhamentos_suporte"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "solicitacoes_comandos_atorId_chave_key" ON "solicitacoes_comandos" ("atorId", chave);
CREATE TABLE "solicitacoes_mensagens" (
  "mensagemId" TEXT PRIMARY KEY, "solicitacaoId" TEXT NOT NULL, "atorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solicitacoes_mensagens_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens_whatsapp"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "solicitacoes_mensagens_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "encaminhamentos_suporte"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "solicitacoes_mensagens_solicitacaoId_idx" ON "solicitacoes_mensagens" ("solicitacaoId");

-- Evidence and replay results cannot be rewritten or silently removed.
CREATE FUNCTION solicitacoes_evidencia_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'solicitacoes_evidencia_imutavel';
END;
$$;
CREATE TRIGGER solicitacoes_eventos_imutaveis BEFORE UPDATE OR DELETE ON "solicitacoes_eventos"
FOR EACH ROW EXECUTE FUNCTION solicitacoes_evidencia_imutavel();
CREATE TRIGGER solicitacoes_comandos_imutaveis BEFORE UPDATE OR DELETE ON "solicitacoes_comandos"
FOR EACH ROW EXECUTE FUNCTION solicitacoes_evidencia_imutavel();
CREATE TRIGGER solicitacoes_mensagens_imutaveis BEFORE UPDATE OR DELETE ON "solicitacoes_mensagens"
FOR EACH ROW EXECUTE FUNCTION solicitacoes_evidencia_imutavel();
