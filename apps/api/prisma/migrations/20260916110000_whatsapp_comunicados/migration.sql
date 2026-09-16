CREATE TABLE "comunicados_whatsapp" (
  "id" TEXT PRIMARY KEY, "idempotencia" TEXT NOT NULL UNIQUE,
  "titulo" TEXT NOT NULL, "corpo" TEXT NOT NULL, "categoria" TEXT NOT NULL,
  "empresasIds" TEXT[] NOT NULL, "criadoPor" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RASCUNHO', "nomeMeta" TEXT NOT NULL UNIQUE,
  "metaId" TEXT, "statusMeta" TEXT, "motivo" TEXT, "conferidoNaMetaEm" TIMESTAMP(3),
  "confirmadoEm" TIMESTAMP(3), "confirmadoPor" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "comunicado_categoria" CHECK ("categoria" IN ('UTILITY','MARKETING')),
  CONSTRAINT "comunicado_status" CHECK ("status" IN ('RASCUNHO','SUBMETENDO','EM_ANALISE','APROVADO','ENVIANDO','PAUSADO','CONCLUIDO','CANCELADO'))
);
CREATE INDEX "comunicados_whatsapp_status_createdAt_idx" ON "comunicados_whatsapp" ("status", "createdAt");
CREATE TABLE "destinatarios_comunicado_whatsapp" (
  "id" TEXT PRIMARY KEY, "comunicadoId" TEXT NOT NULL REFERENCES "comunicados_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "telefone" TEXT NOT NULL, "nome" TEXT NOT NULL, "contatosIds" TEXT[] NOT NULL, "empresasIds" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDENTE', "motivo" TEXT, "mensagemId" TEXT,
  "iniciadoEm" TIMESTAMP(3), "concluidoEm" TIMESTAMP(3),
  CONSTRAINT "comunicado_destinatario_status" CHECK ("status" IN ('PENDENTE','ENVIANDO','ENVIADO','FALHOU','INDETERMINADO','EXCLUIDO','CANCELADO')),
  UNIQUE ("comunicadoId", "telefone")
);
CREATE INDEX "destinatarios_comunicado_whatsapp_comunicadoId_status_idx" ON "destinatarios_comunicado_whatsapp" ("comunicadoId", "status");
