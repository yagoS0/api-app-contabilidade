// ⚠⚠ O RECIBO DA NEGOCIAÇÃO — o papel de onde sai o parcelamento do Lucro Presumido (01/09/2026).
//
// > Dono: *"em anexo um PDF do relatório de um parcelamento (…) é apenas para ver de onde
// > extraímos as informações"*.
//
// ⚠⚠ A FIXTURE É UM EXCERTO DO TEXTO REAL, COM OS IDENTIFICADORES ANONIMIZADOS — mesma disciplina
// de `parseSitfisRelatorio.test.js`: CNPJ, razão social e número do parcelamento têm o formato, a
// pontuação e o comprimento dos reais, com dígitos FABRICADOS. Fixture entra no histórico do git
// para sempre. ⚠ **Valores, datas, períodos e códigos de receita NÃO foram tocados**: são estrutura
// (e os códigos são tabela pública da Receita) — é deles que a conferência depende.
//
// Conferido contra o PDF real antes de anonimizar: 8 débitos, 4 tributos, zero divergências, e
// `60 × 4.714,17 = 282.850,20` contra um consolidado de `282.850,29`.

import { parseReciboParcelamento, valorBR, tributoDoDebito, agruparPorTributo } from "../parseReciboParcelamento.js";

/** O texto como o `pdf-parse` o entrega: uma célula por linha. */
const RECIBO = `
MINISTÉRIO DA FAZENDASecretaria Especial da Receita Federal do Brasil (RFB)
Recibo da negociação - 17/08/2026
Modalidade:
Parcelamento SimplificadoCONTOSO TECNOLOGIA LTDA
Nome empresarial:Data da consolidação:
17/08/2026
CNPJ:
11.222.333/0001-44
Parcelamento:
0211.00012.0104884128.26-54
Data do requerimento:
17/08/2026
Forma de pagamento
60
282.850,29
Saldo a parcelar (BRL)
Valor das parcelas (BRL)
4.714,17
Quantidade de parcelas
Dívida consolidada
Dívida na data da adesão
Principal (BRL)
232.466,40
Multa (BRL)
46.493,25
Juros (BRL)
3.890,64
Total (BRL)
282.850,29
Lista de débitos
Código de
Receita
Período de apuração
Vencimento
Saldo originário
Principal (BRL)
Multa (BRL)
Juros (BRL)
Valor consolidado
(BRL)
Processo administrativo
CNPJ do débito
Referência
2089-01
1º Trimestre/2026
30/04/2026
BRL 27.874,56
27.874,56
5.574,91
1.229,26
34.678,73
11.222.333/0001-44
2089-01
2º Trimestre/2026
31/07/2026
BRL 108.077,95
108.077,95
21.615,59
1.080,77
130.774,31
11.222.333/0001-44
2172-01
maio/2026
25/06/2026
BRL 16.759,22
16.759,22
3.351,84
372,05
20.483,11
11.222.333/0001-44
2172-01
junho/2026
24/07/2026
BRL 19.666,08
19.666,08
3.933,21
196,66
23.795,95
11.222.333/0001-44
2372-01
1º Trimestre/2026
30/04/2026
BRL 10.754,84
10.754,84
2.150,96
474,28
13.380,08
11.222.333/0001-44
2372-01
2º Trimestre/2026
31/07/2026
BRL 41.441,61
41.441,61
8.288,32
414,41
50.144,34
11.222.333/0001-44
8109-02
maio/2026
25/06/2026
BRL 3.631,16
3.631,16
726,23
80,61
4.438,00
11.222.333/0001-44
8109-02
junho/2026
24/07/2026
BRL 4.260,98
4.260,98
852,19
42,60
5.155,77
11.222.333/0001-44
`;

describe("⚠⚠ o cabeçalho do recibo", () => {
  const r = parseReciboParcelamento(RECIBO);

  it("lê o número, a modalidade e a data da consolidação", () => {
    expect(r.numeroParcelamento).toBe("0211.00012.0104884128.26-54");
    expect(r.modalidade).toBe("Parcelamento Simplificado");
    expect(r.dataConsolidacao).toBe("17/08/2026");
  });

  /**
   * ⚠⚠ O BLOCO DE FORMA DE PAGAMENTO TEM RÓTULOS E VALORES DESENCONTRADOS — os dois rótulos ficam
   * ENTRE os três números. Lido pela "linha seguinte", o saldo devolvia o valor da PARCELA: 4.714,17
   * no lugar de 282.850,29. Este caso é o que trava a leitura no lado certo de cada rótulo.
   */
  it("⚠⚠ separa quantidade, valor da parcela e saldo — sem trocar um pelo outro", () => {
    expect(r.quantidadeParcelas).toBe(60);
    expect(r.valorParcela).toBe(4714.17);
    expect(r.saldoAParcelar).toBe(282850.29);
  });

  it("lê a dívida consolidada, com a multa que o primeiro exemplo do dono não tinha", () => {
    expect(r.consolidado).toEqual({
      principal: 232466.4,
      multa: 46493.25,
      juros: 3890.64,
      total: 282850.29,
    });
  });
});

describe("⚠⚠ a lista de débitos e o agrupamento por tributo", () => {
  const r = parseReciboParcelamento(RECIBO);

  it("lê os OITO débitos", () => {
    expect(r.debitos).toHaveLength(8);
    expect(r.debitos[0]).toMatchObject({
      codigoReceita: "2089-01",
      tributo: "IRPJ",
      periodo: "1º Trimestre/2026",
      vencimento: "30/04/2026",
      principal: 27874.56,
      multa: 5574.91,
      juros: 1229.26,
      total: 34678.73,
    });
  });

  /**
   * ⚠ É assim que o contador escreve o histórico: *"VR REF PARC CSLL 1.TRIM.03/2025,
   * 2.TRIM.06/2025 E 3.TRIM.09/2025 PARC EM 60 PARCELAS"* — um lançamento por tributo, com os
   * PERÍODOS de cada débito no texto. Sem o agrupamento, seriam oito lançamentos em vez de quatro.
   */
  it("⚠⚠ agrupa em QUATRO tributos, somando e guardando os períodos", () => {
    expect(r.porTributo).toHaveLength(4);
    const csll = r.porTributo.find((g) => g.tributo === "CSLL");
    expect(csll.principal).toBe(52196.45); // 10.754,84 + 41.441,61
    expect(csll.total).toBe(63524.42);
    expect(csll.periodos).toEqual(["1º Trimestre/2026", "2º Trimestre/2026"]);
    // ⚠ IRPJ/CSLL são TRIMESTRAIS e PIS/COFINS MENSAIS — a distinção vem do papel, não de nós.
    const pis = r.porTributo.find((g) => g.tributo === "PIS");
    expect(pis.periodos).toEqual(["maio/2026", "junho/2026"]);
  });

  it("⚠ o mapa de código é o do projeto: 8109 PIS · 2172 COFINS · 2089 IRPJ · 2372 CSLL", () => {
    const porCodigo = Object.fromEntries(r.porTributo.map((g) => [g.codigo, g.tributo]));
    expect(porCodigo).toEqual({ "8109": "PIS", "2172": "COFINS", "2089": "IRPJ", "2372": "CSLL" });
  });
});

describe("⚠⚠ a conferência — a contagem NÃO é prova", () => {
  it("o recibo real fecha: nenhuma divergência", () => {
    // Um débito perdido e outro duplicado dariam a mesma QUANTIDADE de linhas. O que se confere é
    // valor: a soma dos débitos contra o bloco "Dívida consolidada".
    expect(parseReciboParcelamento(RECIBO).divergencias).toEqual([]);
  });

  it("⚠⚠ soma que não bate volta NOMEADA — e o dado volta junto, não abortado", () => {
    // O recibo é a fonte; recusá-lo deixaria o contador sem caminho. Ele lê o aviso e decide.
    const adulterado = RECIBO.replace("27.874,56\n5.574,91", "27.874,56\n9.999,99");
    const r = parseReciboParcelamento(adulterado);
    expect(r.divergencias.join(" ")).toMatch(/Multa/i);
    expect(r.debitos).toHaveLength(8);
    expect(r.consolidado.total).toBe(282850.29);
  });

  /**
   * ⚠⚠ É ESTA CONFERÊNCIA QUE PROTEGE O PASSIVO. `parcelas × valor` é o que amortiza o 588 até
   * zerar (decisão do dono: *"o valor da parcela é que desconta do 588"*). Se o produto não fechar
   * com o consolidado, o parcelamento termina com saldo vivo — e é melhor saber disso antes.
   */
  it("⚠⚠ avisa quando `parcelas × valor` não fecha com o consolidado", () => {
    const adulterado = RECIBO.replace("4.714,17", "4.000,00");
    expect(parseReciboParcelamento(adulterado).divergencias.join(" ")).toMatch(/Parcelas/i);
  });

  it("⚠ o arredondamento de centavo por parcela NÃO vira divergência", () => {
    // 60 × 4.714,17 = 282.850,20 contra 282.850,29 no recibo REAL. A RFB arredonda cada prestação.
    expect(parseReciboParcelamento(RECIBO).divergencias.join(" ")).not.toMatch(/Parcelas/i);
  });

  it("⚠⚠ código FORA do mapa não vira tributo por palpite — vira pendência nomeada", () => {
    // Inventar o tributo aqui seria inventar em qual conta a dívida entra.
    const outro = RECIBO.replace(/8109-02/g, "9999-01");
    const r = parseReciboParcelamento(outro);
    const semNome = r.porTributo.find((g) => g.tributo === null);
    expect(semNome).toBeTruthy();
    expect(semNome.codigo).toBe("9999");
    expect(r.divergencias.join(" ")).toMatch(/9999-01/);
    // ⚠ E ele NÃO some nem é somado a outro: a dívida continua na tela, pedindo nome.
    expect(r.debitos).toHaveLength(8);
  });
});

describe("⚠ as peças puras", () => {
  it("`valorBR` devolve `null` para o que não é número — nunca zero", () => {
    // Zero é uma afirmação ("conferi, é zero"); ausência não é. Mesma regra do resto da casa.
    expect(valorBR("27.874,56")).toBe(27874.56);
    expect(valorBR("BRL 27.874,56")).toBe(27874.56);
    expect(valorBR("")).toBeNull();
    expect(valorBR("Principal (BRL)")).toBeNull();
    expect(valorBR("60")).toBeNull(); // inteiro sem centavos não é valor monetário aqui
  });

  it("`tributoDoDebito` usa os 4 primeiros dígitos, e não fabrica dígito", () => {
    expect(tributoDoDebito({ codigoReceita: "2089-01" })).toBe("IRPJ");
    expect(tributoDoDebito({ codigoReceita: "8109-02" })).toBe("PIS");
    // ⚠ Código curto NÃO vira código longo por `padStart` — a classe do `cLocEmi="0000000"`.
    expect(tributoDoDebito({ codigoReceita: "089" })).toBeNull();
    expect(tributoDoDebito({ codigoReceita: "9999-01" })).toBeNull();
  });

  it("⚠ `agruparPorTributo` não engole débito sem tributo num balde comum", () => {
    const g = agruparPorTributo([
      { tributo: null, codigo: "9999", principal: 10, multa: 0, juros: 0, total: 10, periodo: "maio/2026" },
      { tributo: null, codigo: "8888", principal: 20, multa: 0, juros: 0, total: 20, periodo: "junho/2026" },
    ]);
    // Dois códigos desconhecidos são DOIS grupos: somá-los perderia de qual dívida cada valor é.
    expect(g).toHaveLength(2);
  });
});
