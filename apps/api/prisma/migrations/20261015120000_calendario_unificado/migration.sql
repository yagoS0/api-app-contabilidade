-- Additive transition; original task records and fiscal documents are preserved.
-- Prisma migrate deploy does not wrap PostgreSQL migrations in a transaction.
BEGIN;
-- Keep snapshots and imports consistent with the exact state being deactivated.
LOCK TABLE "obrigacoes", "regras_obrigacao", "tarefas_agenda" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "tarefas_calendario" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "titulo" TEXT NOT NULL,
  "descricao" TEXT, "config" JSONB NOT NULL,
  "empresasIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subtarefas" JSONB NOT NULL DEFAULT '[]', "versoes" JSONB NOT NULL DEFAULT '[]',
  "estados" JSONB NOT NULL DEFAULT '{}', "excluidaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tarefas_calendario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tarefas_calendario_userId_excluidaEm_idx" ON "tarefas_calendario"("userId", "excluidaEm");
CREATE TABLE "calendario_legado_snapshots" (
  "id" TEXT NOT NULL, "tipo" TEXT NOT NULL, "dados" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendario_legado_snapshots_pkey" PRIMARY KEY ("id")
);
-- Full reversible evidence of the precise records deactivated in this transition.
INSERT INTO "calendario_legado_snapshots" ("id","tipo","dados")
SELECT 'obrigacao:' || "id", 'OBRIGACAO', to_jsonb(o) FROM "obrigacoes" o WHERE "tipo" = 'OBRIGACAO';
INSERT INTO "calendario_legado_snapshots" ("id","tipo","dados")
SELECT 'regra:' || "id", 'REGRA', to_jsonb(r) FROM "regras_obrigacao" r;
UPDATE "obrigacoes" SET "ativa" = false WHERE "tipo" = 'OBRIGACAO';
-- RegraObrigacao has no tipo: its service explicitly rejects tipo=TAREFA.
-- Manual company tasks are direct Obrigacao rows and retain their active flag.
UPDATE "regras_obrigacao" SET "ativa" = false, "aplicarANovas" = false;
-- Only migrate personal tasks whose recurrence/history have an exact representation.
-- Complex versioned, adjusted or per-day histories remain in the previous task view.
INSERT INTO "tarefas_calendario" ("id","userId","titulo","descricao","config","estados","excluidaEm","createdAt","updatedAt")
SELECT 'legado:' || t."id", t."userId", t."titulo", t."descricao",
  t."config" || jsonb_build_object('horarioModo', CASE WHEN t."config"->>'horaInicio' IS NOT NULL THEN 'FIXO' ELSE 'SEM' END,
    'horaLimite',NULL,'diaVencimento',NULL,'dataVencimento',NULL,'repetirQuantidade',NULL),
  t."estados", t."excluidaEm", t."createdAt", t."updatedAt"
FROM "tarefas_agenda" t
WHERE coalesce(t."config"->>'ajusteDiaUtil','MANTER') = 'MANTER'
  AND coalesce(t."config"->'versoes','[]'::jsonb) = '[]'::jsonb
  AND coalesce(t."config"->'exclusoes','[]'::jsonb) = '[]'::jsonb
  AND t."config"->>'encerradaAPartirDe' IS NULL
  AND t."config"->>'horaFim' IS NULL
  AND NOT EXISTS (SELECT 1 FROM jsonb_each(t."estados") e WHERE e.key LIKE '%@%' OR e.value ? 'alteracoes');
COMMIT;
