/** @jest-environment node */
import { gerarRelatorioPlanejamento, modeloRelatorioPlanejamento } from "../pdfPlanejamento";
import { compararRegimes } from "../comparador";
import { montarComparativo } from "../comparativoDeRegimes";
import { CENARIO } from "../ibsCbsNoSimples";
const PDFDocument = require("pdfkit");
const parse = require("pdf-parse/lib/pdf-parse.js");
const entradas = { receitaAnual: 276915.12, rbt12: 293653.78, folhaAnual: 60000, folhaRemuneracoesAnual: 50000, encargosAdicionaisAnuais: 0, anexoSimples: "III", sujeitoAoFatorR: true, atividadePresumido: "servicos", aliquotaIss: .05, margemLucro: .25, creditosPisCofins: 0 };
const resultado = compararRegimes(entradas);
const args = { empresa: { razao: "Empresa Exemplo" }, entradas, resultado, comparativo: montarComparativo(resultado, entradas), formulario: { sujeitoFatorR: true, cenarioIbsCbs: CENARIO.DE_2027_A_2028, cbsEstimada: "8,8", ajustes: { incluirIbsCbs: true } } };
test("PDF inclui valores do cenário, alíquotas, cinco anexos e falta para fator R", async () => {
  const blob = await gerarRelatorioPlanejamento(args, PDFDocument);
  const pdf = await parse(Buffer.from(await blob.arrayBuffer()));
  expect(pdf.numpages).toBeGreaterThan(3);
  for (const value of ["Empresa Exemplo", "Premissas", "Comparativos e quadros", "Cálculo comparativo de impostos", "293.653,78", "82.223,06", "22.223,06", "20,4322%", "Alíquota", "Crédito transferido ao comprador"]) expect(pdf.text).toContain(value);
  for (const anexo of ["I", "II", "III", "IV", "V"]) expect(pdf.text).toContain(`Anexo ${anexo} -`);
  expect(pdf.text).toContain("Não altera os totais anuais");
  expect(pdf.text).not.toContain("NaN");
}, 20000);
test("limite exato de fator R não ganha um centavo por arredondamento binário", async () => {
  const e = { ...entradas, rbt12: 300000, folhaAnual: 84000 };
  const r = compararRegimes(e);
  const blob = await gerarRelatorioPlanejamento({ ...args, entradas: e, resultado: r, comparativo: montarComparativo(r, e) }, PDFDocument);
  const pdf = await parse(Buffer.from(await blob.arrayBuffer()));
  expect(pdf.text).toContain("84.000,00");
  expect(pdf.text).not.toContain("84.000,01");
}, 20000);
test("excluir IBS/CBS não imprime estimativa salva; falta de folha não vira zero", async () => {
  const e = { ...entradas, folhaAnual: null };
  const r = compararRegimes(e);
  const input = { ...args, entradas: e, resultado: r, comparativo: montarComparativo(r, e), formulario: { ...args.formulario, ajustes: { incluirIbsCbs: false } } };
  expect(modeloRelatorioPlanejamento(input).ibs).toBeNull();
  const blob = await gerarRelatorioPlanejamento(input, PDFDocument);
  const pdf = await parse(Buffer.from(await blob.arrayBuffer()));
  expect(pdf.text).toContain("Fator R indisponível");
  expect(pdf.text).toContain("Não incluído");
  expect(pdf.text).not.toContain("Quanto falta de folha em 12 meses");
  expect(pdf.text).not.toContain("Crédito transferido ao comprador");
}, 20000);
