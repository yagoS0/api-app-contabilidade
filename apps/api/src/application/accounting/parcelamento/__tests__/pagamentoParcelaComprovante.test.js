// A BAIXA DA PARCELA A PARTIR DO COMPROVANTE — as duas naturezas dentro do mesmo documento.
//
// ⚠ O DEFEITO QUE ISTO CORRIGE. Na adesão, o passivo do parcelamento (PARC) é creditado pelo valor
// CONSOLIDADO — principal + multa + juros da consolidação — e os três já viram despesa ali. Na
// baixa, o caminho antigo debita o passivo SÓ pelo principal e joga multa e juros em despesa de
// novo. Duas consequências somadas: o custo é reconhecido duas vezes, e o passivo guarda para
// sempre um resíduo igual a `jurosConsolidado + multaConsolidada`.
//
// O comprovante resolve porque o CÓDIGO DE RECEITA diz qual é qual:
//   códigos-tributo (2089, 8109, …) → dívida consolidada sendo AMORTIZADA  → debita o passivo
//   códigos TJLP    (0380, 0389, …) → encargo CORRENTE do mês              → despesa

import { parseComposicaoComprovante } from "../../../fiscal/serpro/parseComposicaoComprovante";
import { classificarDocumentoArrecadado } from "../../../fiscal/serpro/classificarDocumentoArrecadado";

const R1 = "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido163,4032,6614,52210,58\n0380TJLP - IRPJ - Parcelamentos--11,7811,78\n01 - TJLP IRPJ - PARCELAMENTO\n8109PIS - Faturamento23,024,601,4629,08\n0389TJLP - PIS - Parcelamentos--1,621,62\n01 - TJLP PIS - PARCELAMENTO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou98,0119,608,71126,32\n0391TJLP - CSLL - Parcelamentos--7,067,06\n01 - TJLP CSLL - PARCELAMENTO\n2172COFINS - Contribuição para financiamento da segurid. social108,1521,624,85134,62\n0387TJLP - COFINS - Parcelamentos--7,527,52\n01 - TJLP COFINS - PARCELAMENTO\nTotais\n392,5878,4857,52528,58";

// Réplica exata da montagem de `linhasPagamentoDoComprovante`, sem o banco: o que se testa aqui é
// a REGRA (que valor vai para que papel), não a resolução de conta.
function montarLinhas(classificacao) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const linhas = [];
  for (const i of classificacao.itensTributo) {
    const valor = r2(i.principal + i.multa + i.juros);
    if (valor > 0) linhas.push({ tipo: "D", tipoLinha: "PARC", codigoTributo: i.codigo, valor });
  }
  for (const i of classificacao.itensTjlp) {
    if (r2(i.total) > 0) linhas.push({ tipo: "D", tipoLinha: "JUROS", codigoTributo: i.codigo, valor: r2(i.total) });
  }
  linhas.push({ tipo: "C", tipoLinha: "CAIXA", codigoTributo: null, valor: r2(linhas.reduce((s, l) => s + l.valor, 0)) });
  return linhas;
}

const linhas = montarLinhas(classificarDocumentoArrecadado(parseComposicaoComprovante(R1)));
const soma = (f) => Math.round(linhas.filter(f).reduce((s, l) => s + l.valor, 0) * 100) / 100;

describe("R1 — o lançamento da parcela", () => {
  it("⚠ D passivo 500,60 · D despesa 27,98 · C caixa 528,58", () => {
    expect(soma((l) => l.tipoLinha === "PARC")).toBe(500.6);
    expect(soma((l) => l.tipoLinha === "JUROS")).toBe(27.98);
    expect(soma((l) => l.tipoLinha === "CAIXA")).toBe(528.58);
  });

  it("o lote FECHA: débitos == créditos", () => {
    // Cada linha vira um AccountingEntry de uma perna só; o balanço fecha no conjunto, pelo lote.
    expect(soma((l) => l.tipo === "D")).toBe(soma((l) => l.tipo === "C"));
  });

  it("⚠ multa e juros do CÓDIGO-TRIBUTO amortizam o passivo — não viram despesa", () => {
    // É aqui que mora a dupla contagem do caminho antigo: 78,48 de multa + 29,54 de juros já
    // foram reconhecidos como despesa na adesão, e ele os reconheceria de novo.
    const irpj = linhas.find((l) => l.codigoTributo === "2089");
    expect(irpj).toMatchObject({ tipoLinha: "PARC", valor: 210.58 });   // 163,40 + 32,66 + 14,52
    expect(soma((l) => l.tipoLinha === "PARC")).toBe(392.58 + 78.48 + 29.54);
  });

  it("⚠ e o passivo NÃO fica com resíduo: a amortização é o consolidado da parcela", () => {
    // No caminho antigo o passivo só recebia os 392,58 de principal, e os 108,02 de multa (78,48)
    // + juros (29,54) consolidados nunca baixavam — ficavam no 553 para sempre.
    expect(soma((l) => l.tipoLinha === "PARC")).not.toBe(392.58);
    expect(soma((l) => l.tipoLinha === "PARC") - 392.58).toBeCloseTo(108.02, 2);
  });

  it("só o TJLP vira despesa, e um lançamento por código", () => {
    const tjlp = linhas.filter((l) => l.tipoLinha === "JUROS");
    expect(tjlp.map((l) => l.codigoTributo)).toEqual(["0380", "0389", "0391", "0387"]);
    expect(tjlp.map((l) => l.valor)).toEqual([11.78, 1.62, 7.06, 7.52]);
  });

  it("cada linha carrega o código — é o que deixa a conta parametrizável por tributo", () => {
    // `MapaContaTributo` já indexa por (tipoLinha, codigoTributo): dá para mandar o TJLP 0380
    // para uma conta diferente da dos juros comuns sem inventar papel novo.
    expect(linhas.filter((l) => l.tipo === "D").every((l) => /^\d{4}$/.test(l.codigoTributo))).toBe(true);
  });
});
