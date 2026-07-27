-- Checklist de conferência do mês: mesma ideia do folhaProlaboreOk (Q47), agora para despesas,
-- receitas, provisões e pagamentos. Cada uma trava o fechamento contábil até ser marcada.
--
-- Aditiva e nullable: NULL = não conferido (mesmo efeito de false). Meses já fechados no passado
-- não são afetados — a trava só é avaliada no ato de fechar.
ALTER TABLE "company_monthly_circulars" ADD COLUMN IF NOT EXISTS "despesasOk"   BOOLEAN;
ALTER TABLE "company_monthly_circulars" ADD COLUMN IF NOT EXISTS "receitasOk"   BOOLEAN;
ALTER TABLE "company_monthly_circulars" ADD COLUMN IF NOT EXISTS "provisoesOk"  BOOLEAN;
ALTER TABLE "company_monthly_circulars" ADD COLUMN IF NOT EXISTS "pagamentosOk" BOOLEAN;
