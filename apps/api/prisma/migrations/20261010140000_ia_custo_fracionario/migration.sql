-- Preserva reservas e histórico sem tokens conhecidos. Preços vigentes na integração.
ALTER TABLE "chamadas_ia" ALTER COLUMN "custoEstimadoCentavos" TYPE DECIMAL(20,8);
UPDATE "chamadas_ia"
SET "custoEstimadoCentavos" = (
  "inputTokens"::numeric * CASE "modelo" WHEN 'gpt-5.4-mini' THEN 75 WHEN 'claude-opus-5' THEN 500 WHEN 'claude-sonnet-5' THEN 300 ELSE 100 END
  + "outputTokens"::numeric * CASE "modelo" WHEN 'gpt-5.4-mini' THEN 450 WHEN 'claude-opus-5' THEN 2500 WHEN 'claude-sonnet-5' THEN 1500 ELSE 500 END
  + "cacheReadTokens"::numeric * CASE "modelo" WHEN 'gpt-5.4-mini' THEN 7.5 WHEN 'claude-opus-5' THEN 50 WHEN 'claude-sonnet-5' THEN 30 ELSE 10 END
  + "cacheCreationTokens"::numeric * CASE "modelo" WHEN 'gpt-5.4-mini' THEN 0 WHEN 'claude-opus-5' THEN 625 WHEN 'claude-sonnet-5' THEN 375 ELSE 125 END
) / 1000000
WHERE "modelo" IN ('gpt-5.4-mini','claude-opus-5','claude-sonnet-5','claude-haiku-4-5-20251001')
  AND status IN ('ok','erro')
  AND "inputTokens" + "outputTokens" + "cacheReadTokens" + "cacheCreationTokens" > 0;
