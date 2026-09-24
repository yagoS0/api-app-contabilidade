CREATE TABLE "email_login_challenges" (
  "emailKey" TEXT NOT NULL PRIMARY KEY,
  "challengeId" TEXT NOT NULL,
  "userId" TEXT,
  "credentialVersion" TEXT,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "usedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "sentCount" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "email_login_challenges_challengeId_key" ON "email_login_challenges"("challengeId");
CREATE INDEX "email_login_challenges_expiresAt_idx" ON "email_login_challenges"("expiresAt");
