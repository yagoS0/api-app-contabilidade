-- Módulo Fiscal (Frente B): valor original × juros/multa por tributo na circular.
-- { <tributo>: { principal, juros, multa } }. Aditiva e não-destrutiva (ADD-only).
ALTER TABLE "company_monthly_circulars" ADD COLUMN IF NOT EXISTS "acrescimos" JSONB;
