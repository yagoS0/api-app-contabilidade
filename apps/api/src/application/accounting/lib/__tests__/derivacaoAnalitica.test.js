import {
  normalizarCodigoCompleto,
  conjuntoDeCodigosCompletos,
  ehSintetica,
  derivarAnalitica,
  resumirDerivacao,
} from "../derivacaoAnalitica.js";

describe("derivacaoAnalitica — a regra", () => {
  test("mãe com filha mais longa é SINTÉTICA; a filha é analítica", () => {
    const r = derivarAnalitica([
      { codigo: "1", codigoCompleto: "1" },
      { codigo: "5", codigoCompleto: "111010001" },
    ]);
    expect(r[0].analitica).toBe(false);
    expect(r[1].analitica).toBe(true);
  });

  test("a cadeia inteira do plano real: 1 · 11 · 111 · 11101 · 111010001", () => {
    const r = derivarAnalitica([
      { codigo: "1", codigoCompleto: "1" },
      { codigo: "2", codigoCompleto: "11" },
      { codigo: "3", codigoCompleto: "111" },
      { codigo: "4", codigoCompleto: "11101" },
      { codigo: "5", codigoCompleto: "111010001" },
    ]);
    expect(r.map((c) => c.analitica)).toEqual([false, false, false, false, true]);
  });

  test("folha sem irmã mais longa é analítica", () => {
    const r = derivarAnalitica([{ codigo: "9", codigoCompleto: "111010002" }]);
    expect(r[0].analitica).toBe(true);
  });

  test("nenhum código é mãe de si mesmo (comprimento igual não conta)", () => {
    expect(ehSintetica("111", new Set(["111"]))).toBe(false);
  });

  test("código duplicado no conjunto não torna a conta sintética", () => {
    const r = derivarAnalitica([
      { codigo: "a", codigoCompleto: "111" },
      { codigo: "b", codigoCompleto: "111" },
    ]);
    expect(r.every((c) => c.analitica === true)).toBe(true);
  });

  test("prefixo mais longo que NÃO é ancestral ainda assim conta — é a regra declarada", () => {
    // "5" é prefixo de "50" no plano real, e a regra do dono é prefixo puro sobre o COMPLETO.
    expect(ehSintetica("5", new Set(["5", "50"]))).toBe(true);
  });
});

describe("derivacaoAnalitica — ausência nunca é resposta", () => {
  test("conta sem codigoCompleto sai com analitica NULL, nunca false", () => {
    const r = derivarAnalitica([{ codigo: "999", codigoCompleto: null }]);
    expect(r[0].analitica).toBeNull();
    expect(r[0].analitica).not.toBe(false);
  });

  test("string vazia e espaços em branco também são ausência", () => {
    expect(normalizarCodigoCompleto("")).toBeNull();
    expect(normalizarCodigoCompleto("   ")).toBeNull();
    expect(derivarAnalitica([{ codigoCompleto: "  " }])[0].analitica).toBeNull();
    expect(ehSintetica("", new Set(["1", "11"]))).toBeNull();
  });

  test("conta sem código completo não entra no conjunto de comparação", () => {
    const set = conjuntoDeCodigosCompletos([
      { codigoCompleto: "11" },
      { codigoCompleto: null },
      { codigoCompleto: "" },
    ]);
    expect([...set]).toEqual(["11"]);
  });

  test("a mãe cuja ÚNICA filha não foi importada sai ANALÍTICA, não sintética", () => {
    // O erro tem direção: conjunto menor produz MENOS sintéticas. A conta continua na sugestão,
    // que é o estado de hoje — o erro caro (tirar da lista uma conta em uso) não é alcançável.
    const r = derivarAnalitica([
      { codigo: "1", codigoCompleto: "1" },
      { codigo: "9", codigoCompleto: null },
    ]);
    expect(r[0].analitica).toBe(true);
  });
});

describe("derivacaoAnalitica — o escopo", () => {
  test("dois escopos derivados juntos dariam resposta diferente de derivados separados", () => {
    const global = [{ codigo: "1", codigoCompleto: "1" }, { codigo: "5", codigoCompleto: "111010001" }];
    const empresa = [{ codigo: "1", codigoCompleto: "1" }];

    expect(derivarAnalitica(global)[0].analitica).toBe(false); // tem filha no próprio escopo
    expect(derivarAnalitica(empresa)[0].analitica).toBe(true); // sozinha no dela

    // Misturar afirmaria parentesco entre planos diferentes:
    expect(derivarAnalitica([...global, ...empresa])[2].analitica).toBe(false);
  });
});

describe("derivacaoAnalitica — a armadilha das colunas", () => {
  test('derivar do REDUZIDO em vez do COMPLETO troca a resposta sem dar erro', () => {
    // "5" reduzido = CAIXA - MATRIZ (analítica, completo 111010001).
    // "5" completo  = (-) IRPJ/CSLL (reduzido 590).
    const plano = [
      { codigo: "5", codigoCompleto: "111010001" },
      { codigo: "590", codigoCompleto: "5" },
      { codigo: "591", codigoCompleto: "50" },
    ];
    const certo = derivarAnalitica(plano);
    expect(certo.find((c) => c.codigo === "5").analitica).toBe(true); // CAIXA - MATRIZ é folha
    expect(certo.find((c) => c.codigo === "590").analitica).toBe(false); // "5" tem "50" abaixo

    // Se alguém trocar as colunas (usar o reduzido como se fosse o completo):
    const trocado = derivarAnalitica(plano.map((c) => ({ ...c, codigoCompleto: c.codigo })));
    expect(trocado.find((c) => c.codigo === "5").analitica).toBe(false); // CAIXA vira SINTÉTICA
  });
});

describe("resumirDerivacao", () => {
  test("conta as três respostas separadamente", () => {
    const r = resumirDerivacao([
      { analitica: true }, { analitica: true }, { analitica: false }, { analitica: null },
    ]);
    expect(r).toEqual({ total: 4, analiticas: 2, sinteticas: 1, semResposta: 1 });
  });

  test("lista vazia não quebra", () => {
    expect(resumirDerivacao([])).toEqual({ total: 0, analiticas: 0, sinteticas: 0, semResposta: 0 });
    expect(derivarAnalitica(null)).toEqual([]);
  });
});
