ALTER TABLE "regime_historico" ADD COLUMN "apuracaoIbsCbs" TEXT, ADD COLUMN "comprovanteOpcaoIbsCbs" TEXT;
ALTER TABLE "regime_historico" ADD CONSTRAINT "regime_historico_ibscbs_opcao_check" CHECK ("apuracaoIbsCbs" IS NULL OR ("apuracaoIbsCbs" IN ('NO_DAS', 'REGULAR') AND "regime" = 'SIMPLES' AND "vigenciaInicio" >= TIMESTAMP '2027-01-01'));
