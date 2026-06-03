-- Q12.B+: cursor ADN/NFS-e SEPARADO do lastCursor legado (que é do AdnSyncService→AdnDocument).
-- Esse cursor é do novo AdnNotasService que grava em PortalInvoice (módulo Notas).
-- PortalSyncState não tem @@map → tabela usa PascalCase.

ALTER TABLE "PortalSyncState"
  ADD COLUMN "adnNsuCursor"    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "adnLastSyncAt"   TIMESTAMP(3),
  ADD COLUMN "adnLastError"    TEXT,
  ADD COLUMN "adnBackoffUntil" TIMESTAMP(3);
