-- Histórico opcional por linha (suporta lançamentos como pró-labore onde
-- cada linha tem descrição distinta: bruto, INSS, IRRF, líquido).
ALTER TABLE "accounting_entry_lines" ADD COLUMN "historico" TEXT;
