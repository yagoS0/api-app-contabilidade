-- Add login/password to Client for auth
ALTER TABLE "Client"
ADD COLUMN "login" TEXT,
ADD COLUMN "passwordHash" TEXT;

-- Backfill: if you have existing rows, you must populate login/passwordHash manually
-- Example: set login = lower(email) for existing records (adjust as needed):
-- UPDATE "Client" SET "login" = lower("email") WHERE "login" IS NULL;

-- Constraints
ALTER TABLE "Client"
ALTER COLUMN "login" SET NOT NULL,
ALTER COLUMN "passwordHash" SET NOT NULL;

CREATE UNIQUE INDEX "Client_login_key" ON "Client"("login");
