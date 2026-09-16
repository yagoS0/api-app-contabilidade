import { secoesDosEstudos } from "../pdf/estudosNoRelatorio.js";
import { gerarPdfPlanejamento } from "../pdf/gerarPdfPlanejamento.js";
const estudo = {
  operacoes: { operacoes: [{ competencia: "2026-01", regime: "LUCRO_PRESUMIDO", tributo: "ICMS", base: 1000, aliquota: 18, total: 123.45, fundamento: "Base de teste" }] },
  mensal: { resultados: [{ regime: "LUCRO_REAL", total: null, subtotalConhecido: 987.65, meses: [{ competencia: "2026-01", receita: 100000, ativo: true, total: null, tributos: { pis: 123.45 }, memoria: { tributos: { pis: { base: 90000, aliquota: .0165, credito: 30, saldoAnterior: 0 } } }, pendencias: ["Falta base de CSLL"] }] }] },
  reforma: { ano: 2029, operacoes: [{ base: 10000, cbsPct: 9, ibsPct: 2, cbs: 900, ibs: 200, legado: 450 }], creditos: [{ fornecedor: "Fornecedor teste", documento: "DOC-1", cbs: 100, ibs: 20 }], cbs: 800, ibs: 180, legado: 450, total: 1430, excedenteCbs: 0, excedenteIbs: 0 },
};
test("relatório preserva valores da foto, créditos, origem e pendências sem recalcular", () => {
  const antes = JSON.stringify(estudo), texto = secoesDosEstudos(estudo).flatMap(s => s.linhas).join(" ");
  expect(texto).toContain("123,45"); expect(texto).toContain("1,65%");
  expect(texto).toContain("Falta base de CSLL"); expect(texto).toContain("DOC-1");
  expect(texto).toContain("1.430,00"); expect(JSON.stringify(estudo)).toBe(antes);
});
test("fotos antigas não ganham estudos artificiais", () => expect(secoesDosEstudos(null)).toEqual([]));
test("ausência permanece distinta de zero", () => {
  const linhas = secoesDosEstudos({ operacoes: { operacoes: [{ base: null, total: 0 }] } })[0].linhas.join(" ");
  expect(linhas).toContain("Base final não informado"); expect(linhas).toMatch(/total R\$\s0,00/);
});
test("gerador real inclui estudos sem falhar para fotos legadas", async () => {
  for (const estudosAvancados of [undefined, estudo]) {
    const pdf = await gerarPdfPlanejamento({ foto: { competencia: "2026-09", geradoEm: "2026-09-16T12:00:00Z", resultado: { estudosAvancados } }, empresa: { razao: "Empresa fictícia" } });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(pdf.length).toBeGreaterThan(1000);
  }
});
