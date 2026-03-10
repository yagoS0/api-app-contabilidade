-- Legacy migration guard:
-- In some environments this migration can run before AdnDocument exists.
DO $$
BEGIN
  IF to_regclass('public."AdnDocument"') IS NOT NULL THEN
    ALTER TABLE "AdnDocument"
      ALTER COLUMN "dataHoraGeracao" SET DATA TYPE TIMESTAMP(3),
      ALTER COLUMN "dataEmissao" SET DATA TYPE TIMESTAMP(3),
      ALTER COLUMN "competencia" SET DATA TYPE TIMESTAMP(3),
      ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
      ALTER COLUMN "updatedAt" DROP DEFAULT,
      ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public."AdnSyncState"') IS NOT NULL THEN
    ALTER TABLE "AdnSyncState"
      ALTER COLUMN "updatedAt" DROP DEFAULT,
      ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);
  END IF;
END
$$;
