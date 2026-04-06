-- E-mail dedicado ao envio de guias por empresa (pode repetir entre CNPJs distintos).
ALTER TABLE "PortalClient" ADD COLUMN "guideNotificationEmail" TEXT;

UPDATE "PortalClient" p
SET "guideNotificationEmail" = LOWER(TRIM(c.email))
FROM "Company" c
WHERE p."companyId" = c.id
  AND p."guideNotificationEmail" IS NULL
  AND c.email IS NOT NULL
  AND TRIM(c.email) <> '';
