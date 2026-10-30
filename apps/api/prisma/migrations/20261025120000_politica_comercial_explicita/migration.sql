-- No default or backfill: historical cases retain their policy.
ALTER TABLE "onboardings" ADD COLUMN "politicaComercial" TEXT;
