-- Q12.B.1: cursor DFe (NF-e/SEFAZ) separado do cursor ADN (NFS-e).
-- PortalSyncState não tem @@map → tabela usa PascalCase.

ALTER TABLE "PortalSyncState"
  ADD COLUMN "dfeNsuCursor"    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "dfeLastSyncAt"   TIMESTAMP(3),
  ADD COLUMN "dfeLastError"    TEXT,
  ADD COLUMN "dfeBackoffUntil" TIMESTAMP(3);
