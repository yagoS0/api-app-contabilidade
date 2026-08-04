-- "Olhei" separado de "recebi".
--
-- `adnLastSyncAt`/`dfeLastSyncAt` só são gravados quando vem documento. Com o cursor NSU travado, a
-- empresa era varrida todo dia com sucesso e o campo continuava velho — no diagnóstico ela parecia
-- abandonada, e uma empresa legitimamente quieta ficava indistinguível de uma com a captura
-- quebrada. Foi nessa ambiguidade que o defeito passou 29 dias despercebido.

ALTER TABLE "PortalSyncState" ADD COLUMN "adnLastAttemptAt" TIMESTAMP(3);
ALTER TABLE "PortalSyncState" ADD COLUMN "dfeLastAttemptAt" TIMESTAMP(3);
