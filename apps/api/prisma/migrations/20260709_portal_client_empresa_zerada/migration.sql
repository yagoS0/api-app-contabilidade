-- Empresa zerada (sem movimento): não gera impostos; enviamos apenas obrigações zeradas.
-- Aditiva e não-destrutiva (ADD-only, sem DROP / sem reset). Default false = comportamento atual.
ALTER TABLE "PortalClient" ADD COLUMN IF NOT EXISTS "empresaZerada" BOOLEAN NOT NULL DEFAULT false;
