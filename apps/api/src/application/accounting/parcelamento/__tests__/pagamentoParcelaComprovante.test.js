// A BAIXA DA PARCELA A PARTIR DO COMPROVANTE — as duas naturezas dentro do mesmo documento.
//
// ⚠ A REGRA QUE MANDA AQUI É A DA ADESÃO. `linhasProvisao` reconhece SÓ O PRINCIPAL (decisão do
// dono: "juros e multa vêm apenas da confirmação do pagamento"), então o passivo nasce valendo
// `principalTotal`. Segue daí que só o PRINCIPAL pode amortizá-lo: debitar também multa e juros
// levaria o passivo a NEGATIVO ao longo do contrato.
//
// Multa, juros consolidados e TJLP são todos despesa DO MÊS DO PAGAMENTO — nenhum foi reconhecido
// na adesão, e é na baixa que entram, uma vez só.
//
// ⚠ ENTÃO O QUE O COMPROVANTE AINDA ENTREGA, se TJLP e juros consolidados caem no mesmo papel? O
// CÓDIGO DE RECEITA REAL em cada linha (0380, 2089…). O `MapaContaTributo` indexa por
// `(tipoLinha, codigoTributo)`, então dá para dar conta própria ao TJLP sem papel novo. Pelo
// caminho antigo isso é impossível: lá o `codigoTributo` gravado é o NOME do tributo ("DAS"), um
// só para a parcela inteira.

import { parseComposicaoComprovante } from "../../../fiscal/serpro/parseComposicaoComprovante";
import { classificarDocumentoArrecadado } from "../../../fiscal/serpro/classificarDocumentoArrecadado";

const R1 = "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido163,4032,6614,52210,58\n0380TJLP - IRPJ - Parcelamentos--11,7811,78\n01 - TJLP IRPJ - PARCELAMENTO\n8109PIS - Faturamento23,024,601,4629,08\n0389TJLP - PIS - Parcelamentos--1,621,62\n01 - TJLP PIS - PARCELAMENTO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou98,0119,608,71126,32\n0391TJLP - CSLL - Parcelamentos--7,067,06\n01 - TJLP CSLL - PARCELAMENTO\n2172COFINS - Contribuição para financiamento da segurid. social108,1521,624,85134,62\n0387TJLP - COFINS - Parcelamentos--7,527,52\n01 - TJLP COFINS - PARCELAMENTO\nTotais\n392,5878,4857,52528,58";

// Réplica exata da montagem de `linhasPagamentoDoComprovante`, sem o banco: o que se testa aqui é
// a REGRA (que valor vai para que papel), não a resolução de conta.
function montarLinhas(classificacao) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const linhas = [];
  for (const i of classificacao.itensTributo) {
    for (const [tipoLinha, valor] of [["PARC", i.principal], ["MULTA", i.multa], ["JUROS", i.juros]]) {
      if (r2(valor) > 0) linhas.push({ tipo: "D", tipoLinha, codigoTributo: i.codigo, valor: r2(valor) });
    }
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
  it("⚠ D passivo 392,58 · D multa 78,48 · D juros 57,52 · C caixa 528,58", () => {
    // O passivo recebe SÓ o principal — é o que a adesão provisionou.
    expect(soma((l) => l.tipoLinha === "PARC")).toBe(392.58);
    expect(soma((l) => l.tipoLinha === "MULTA")).toBe(78.48);
    // Juros = 29,54 consolidados + 27,98 de TJLP. Os dois são despesa deste mês.
    expect(soma((l) => l.tipoLinha === "JUROS")).toBe(57.52);
    expect(soma((l) => l.tipoLinha === "CAIXA")).toBe(528.58);
  });

  it("o lote FECHA: débitos == créditos", () => {
    // Cada linha vira um AccountingEntry de uma perna só; o balanço fecha no conjunto, pelo lote.
    expect(soma((l) => l.tipo === "D")).toBe(soma((l) => l.tipo === "C"));
  });

  it("⚠ o passivo é amortizado EXATAMENTE pelo que a adesão provisionou", () => {
    // A adesão credita PARC pelo principal (`linhasProvisao` reconhece só ele). Debitar aqui
    // também multa e juros levaria o passivo a NEGATIVO ao longo do contrato — foi esse o erro
    // corrigido quando a provisão passou a reconhecer só o principal.
    expect(soma((l) => l.tipoLinha === "PARC")).toBe(392.58);
    expect(soma((l) => l.tipoLinha === "PARC")).not.toBe(500.6);
  });

  it("cada tributo amortiza pelo SEU principal, itemizado", () => {
    const irpj = linhas.filter((l) => l.codigoTributo === "2089");
    expect(irpj.find((l) => l.tipoLinha === "PARC").valor).toBe(163.4);
    expect(irpj.find((l) => l.tipoLinha === "MULTA").valor).toBe(32.66);
    expect(irpj.find((l) => l.tipoLinha === "JUROS").valor).toBe(14.52);
  });

  it("⚠ o TJLP é reconhecível pelo CÓDIGO, e é isso que sobrevive à mudança da provisão", () => {
    // TJLP e juros consolidados caem no mesmo papel por padrão. O que o comprovante entrega é o
    // código real em cada linha: `MapaContaTributo` indexa por (tipoLinha, codigoTributo), então
    // dá para dar conta própria ao TJLP. Pelo caminho antigo o código gravado é "DAS".
    const tjlp = linhas.filter((l) => ["0380", "0389", "0391", "0387"].includes(l.codigoTributo));
    expect(tjlp.every((l) => l.tipoLinha === "JUROS")).toBe(true);
    expect(tjlp.map((l) => l.valor)).toEqual([11.78, 1.62, 7.06, 7.52]);
    expect(Math.round(tjlp.reduce((s, l) => s + l.valor, 0) * 100) / 100).toBe(27.98);
  });

  it("cada linha carrega o código — é o que deixa a conta parametrizável por tributo", () => {
    // `MapaContaTributo` já indexa por (tipoLinha, codigoTributo): dá para mandar o TJLP 0380
    // para uma conta diferente da dos juros comuns sem inventar papel novo.
    expect(linhas.filter((l) => l.tipo === "D").every((l) => /^\d{4}$/.test(l.codigoTributo))).toBe(true);
  });
});
