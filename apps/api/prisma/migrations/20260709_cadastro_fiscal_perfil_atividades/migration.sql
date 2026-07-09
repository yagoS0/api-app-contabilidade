-- Módulo Fiscal (Aba Fiscal / Bloco A): config por CNAE do perfil de atividades da empresa.
-- Aditiva e não-destrutiva (ADD-only, sem DROP / sem reset). Nullable = sem config = deriva do CNAE.
ALTER TABLE "cadastros_fiscais" ADD COLUMN IF NOT EXISTS "perfilAtividades" JSONB;
