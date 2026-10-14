import { relatorioMonitoramentoCsv } from "../relatorioMonitoramento";

test("relatório preserva competência, CNPJ com zero e evidência da entrega externa", () => {
 const csv=relatorioMonitoramentoCsv([{empresa:'Empresa A',cnpj:'01234567000189',categoria:'documentos',titulo:'Falta recibo',detalhe:'Conferir',numeroDeclaracao:'123',estado:'aberta'}],'2026-09');
 expect(csv).toContain('"2026-09";"Empresa A";"\'01234567000189"');
 expect(csv).toContain('"123";"aberta"');
 expect(csv.charCodeAt(0)).toBe(0xFEFF);
});

test("células não executam fórmulas e preservam aspas, separadores e quebras", () => {
 const csv=relatorioMonitoramentoCsv([{empresa:'=HYPERLINK("x")',titulo:'A;B',detalhe:'linha 1\nlinha 2'}],'2026-09');
 expect(csv).toContain('"\'=HYPERLINK(""x"")"');
 expect(csv).toContain('"A;B"');
 expect(csv).toContain('"linha 1\nlinha 2"');
});
