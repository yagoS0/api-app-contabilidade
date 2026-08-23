import {
  CLASSE,
  ANCORAS_DISPONIBILIDADE,
  normalizarCodigoCompleto,
  sobPrefixo,
  classificarDisponibilidade,
  separarDisponibilidades,
  conferirAncoras,
} from "../disponibilidades.js";

// Amostra COPIADA do plano real (produção, medição de 21/08/2026). Os códigos e nomes são os que
// estão na base — nada aqui é inventado.
const PLANO_REAL = [
  { codigo: "1", codigoCompleto: "1", nome: "ATIVO" },
  { codigo: "2", codigoCompleto: "11", nome: "ATIVO CIRCULANTE" },
  { codigo: "3", codigoCompleto: "111", nome: "DISPONIVEL" },
  { codigo: "4", codigoCompleto: "11101", nome: "CAIXA GERAL" },
  { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
  { codigo: "6", codigoCompleto: "111010002", nome: "CAIXA PEQUENO" },
  { codigo: "10", codigoCompleto: "11102", nome: "BANCOS - CONTAS COM MOVIMENTOS" },
  { codigo: "11", codigoCompleto: "111020001", nome: "BANCO ITAU" },
  { codigo: "14", codigoCompleto: "111020004", nome: "BANCO SANTANDER" },
  { codigo: "21", codigoCompleto: "11103", nome: "APLICACOES DE LIQUIDEZ IMEDIATA" },
  // ⚠ as três contraprovas: citam "banco" no nome e NÃO são disponibilidade
  { codigo: "53", codigoCompleto: "112030001", nome: "DUPLICATAS DESCONTADAS BANCO ITAU" },
  { codigo: "271", codigoCompleto: "211060001", nome: "EMPRESTIMOS BANCO ITAU CONTRATO XXXXXX" },
  { codigo: "304", codigoCompleto: "221010001", nome: "EMPRESTIMO BANCO ITAU" },
  // ⚠ a armadilha do reduzido: reduzido "5" é CAIXA - MATRIZ, completo "5" é (-) IRPJ/CSLL
  { codigo: "608", codigoCompleto: "5", nome: "(-) IRPJ/CSLL" },
  // ⚠ conta real sem codigoCompleto (13 assim na base)
  { codigo: "700", codigoCompleto: null, nome: "CONTAS A PAGAR INTERCOMPANY ALBATROZ" },
];

describe("disponibilidades — a regra é o prefixo do codigoCompleto", () => {
  test("caixa e bancos saem pelos ramos 11101 e 11102", () => {
    expect(classificarDisponibilidade({ codigoCompleto: "111010001" })).toBe(CLASSE.CAIXA);
    expect(classificarDisponibilidade({ codigoCompleto: "11101" })).toBe(CLASSE.CAIXA);
    expect(classificarDisponibilidade({ codigoCompleto: "111020001" })).toBe(CLASSE.BANCOS);
    expect(classificarDisponibilidade({ codigoCompleto: "11103" })).toBe(CLASSE.APLICACOES);
  });

  test("a sintética 111 é disponibilidade, mas não diz se é caixa ou banco", () => {
    expect(classificarDisponibilidade({ codigoCompleto: "111" })).toBe(CLASSE.DISPONIVEL_NAO_CLASSIFICADO);
  });

  test("ramo novo sob 111 sai NÃO CLASSIFICADO — não vira caixa por otimismo", () => {
    expect(classificarDisponibilidade({ codigoCompleto: "11109" })).toBe(CLASSE.DISPONIVEL_NAO_CLASSIFICADO);
  });
});

describe("disponibilidades — o que a lista de textos errava", () => {
  test("empréstimo bancário NÃO é disponibilidade, ainda que o nome grite BANCO", () => {
    for (const c of ["112030001", "211060001", "221010001"]) {
      expect(classificarDisponibilidade({ codigoCompleto: c })).toBe(CLASSE.NAO_DISPONIVEL);
    }
  });

  test("⚠ o código REDUZIDO não pode ser usado: completo \"5\" é (-) IRPJ/CSLL, não CAIXA - MATRIZ", () => {
    expect(classificarDisponibilidade({ codigoCompleto: "5" })).toBe(CLASSE.NAO_DISPONIVEL);
    // e a conta cujo REDUZIDO é "5" é caixa — provando que as duas colunas discordam
    const caixaMatriz = PLANO_REAL.find((c) => c.codigo === "5");
    expect(classificarDisponibilidade(caixaMatriz)).toBe(CLASSE.CAIXA);
  });
});

describe("disponibilidades — ausência declarada vence afirmação falsa", () => {
  test("sem codigoCompleto → INDETERMINADO, NUNCA NAO_DISPONIVEL", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(classificarDisponibilidade({ codigoCompleto: v })).toBe(CLASSE.INDETERMINADO);
    }
  });

  test("separarDisponibilidades devolve as desconhecidas NOMEADAS, em lista própria", () => {
    const r = separarDisponibilidades(PLANO_REAL);
    expect(r.caixa.map((c) => c.nome)).toEqual(["CAIXA GERAL", "CAIXA - MATRIZ", "CAIXA PEQUENO"]);
    expect(r.bancos.map((c) => c.nome)).toEqual([
      "BANCOS - CONTAS COM MOVIMENTOS", "BANCO ITAU", "BANCO SANTANDER",
    ]);
    expect(r.aplicacoes).toHaveLength(1);
    expect(r.indeterminadas.map((c) => c.nome)).toEqual(["CONTAS A PAGAR INTERCOMPANY ALBATROZ"]);
    expect(r.disponiveisNaoClassificadas.map((c) => c.nome)).toEqual(["DISPONIVEL"]);
    // nenhuma conta some: toda conta cai em exatamente uma lista
    const total = Object.values(r).reduce((s, l) => s + l.length, 0);
    expect(total).toBe(PLANO_REAL.length);
  });

  test("plano vazio não inventa nada", () => {
    const r = separarDisponibilidades([]);
    expect(r.caixa).toEqual([]);
    expect(r.indeterminadas).toEqual([]);
    expect(separarDisponibilidades(null).bancos).toEqual([]);
  });
});

describe("disponibilidades — o nome é tripwire, não classificador", () => {
  test("plano real passa nas âncoras", () => {
    expect(conferirAncoras(PLANO_REAL).ok).toBe(true);
  });

  test("acento/caixa alta não derrubam a âncora", () => {
    const p = PLANO_REAL.map((c) => (c.codigoCompleto === "11103" ? { ...c, nome: "Aplicações de Liquidez Imediata" } : c));
    expect(conferirAncoras(p).ok).toBe(true);
  });

  test("⚠ plano reimportado com outra numeração GRITA em vez de classificar calado", () => {
    const p = PLANO_REAL.map((c) => (c.codigoCompleto === "11102" ? { ...c, nome: "CLIENTES NACIONAIS" } : c));
    const r = conferirAncoras(p);
    expect(r.ok).toBe(false);
    expect(r.problemas).toEqual([
      { codigoCompleto: "11102", esperado: "BANCOS - CONTAS COM MOVIMENTOS", encontrado: "CLIENTES NACIONAIS" },
    ]);
  });

  test("âncora ausente do plano também é problema (encontrado: null)", () => {
    const r = conferirAncoras(PLANO_REAL.filter((c) => c.codigoCompleto !== "11101"));
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toEqual({ codigoCompleto: "11101", esperado: "CAIXA GERAL", encontrado: null });
  });
});

describe("disponibilidades — utilitários", () => {
  test("normalizarCodigoCompleto: vazio vira null", () => {
    expect(normalizarCodigoCompleto("  111 ")).toBe("111");
    expect(normalizarCodigoCompleto("")).toBeNull();
    expect(normalizarCodigoCompleto(null)).toBeNull();
  });

  test("sobPrefixo inclui a própria âncora", () => {
    expect(sobPrefixo("11101", "11101")).toBe(true);
    expect(sobPrefixo("111010001", "11101")).toBe(true);
    expect(sobPrefixo("11102", "11101")).toBe(false);
    expect(sobPrefixo(null, "111")).toBe(false);
  });

  test("as âncoras são as medidas em 21/08/2026", () => {
    expect(ANCORAS_DISPONIBILIDADE.CAIXA.codigoCompleto).toBe("11101");
    expect(ANCORAS_DISPONIBILIDADE.BANCOS.codigoCompleto).toBe("11102");
  });
});
