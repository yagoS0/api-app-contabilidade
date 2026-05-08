-- Remove lançamentos INSS_DCTFWEB auto-gerados em RASCUNHO.
-- INSS agora é lançado manualmente em conjunto com folha/pró-labore via PayrollEntryModal.
-- Lançamentos em CONFIRMADO ou EXPORTADO são preservados (responsabilidade do contador).
-- accounting_entry_lines tem ON DELETE CASCADE, então as linhas são removidas automaticamente.

DELETE FROM "accounting_entries"
WHERE "eventType" = 'INSS_DCTFWEB' AND "status" = 'RASCUNHO';
