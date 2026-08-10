// A SUGESTÃO DE HISTÓRICO DO IMPORT DE EXCEL.
//
// O que estes testes travam é a GUARDA do prefixo e a precedência da memória. Sem a guarda, as
// descrições que já começam com "PAGO" (41 dos 230 registros desta base) viram "PAGO PAGO ALUGUEL";
// sem a precedência, o histórico que o contador escreveu num import anterior é sobrescrito por um
// prefixo automático — que é descartar a única coisa que ele ensinou ao sistema.

import { comPrefixoPago, historicoSugeridoDaLinha } from "../historicoSugerido.js";

describe("comPrefixoPago", () => {
  it("prefixa a descrição comum", () => {
    expect(comPrefixoPago("ALUGUEL SALA 302")).toBe("PAGO ALUGUEL SALA 302");
  });

  it("⚠ NÃO duplica o prefixo quando a descrição já começa com PAGO", () => {
    expect(comPrefixoPago("PAGO ALUGUEL")).toBe("PAGO ALUGUEL");
    expect(comPrefixoPago("PAGO INSS - 06/2026")).toBe("PAGO INSS - 06/2026");
  });

  it("⚠ a guarda ignora a caixa — 'Pago aluguel' também já tem prefixo", () => {
    expect(comPrefixoPago("Pago aluguel")).toBe("Pago aluguel");
    expect(comPrefixoPago("pago aluguel")).toBe("pago aluguel");
  });

  it("⚠ a âncora é o TOKEN 'PAGO', não as quatro letras", () => {
    // "PAGAMENTO" não começa com PAGO; tratá-lo como se começasse deixaria a linha sem prefixo.
    expect(comPrefixoPago("PAGAMENTO FORNECEDOR")).toBe("PAGO PAGAMENTO FORNECEDOR");
    expect(comPrefixoPago("PAGOU O BOLETO")).toBe("PAGO PAGOU O BOLETO");
  });

  it("descrição vazia não vira 'PAGO ' solto — campo que parece preenchido é pior que campo vazio", () => {
    expect(comPrefixoPago("")).toBe("");
    expect(comPrefixoPago("   ")).toBe("");
    expect(comPrefixoPago(null)).toBe("");
    expect(comPrefixoPago(undefined)).toBe("");
  });

  it("apara as bordas antes de prefixar", () => {
    expect(comPrefixoPago("  ENERGIA CEMIG  ")).toBe("PAGO ENERGIA CEMIG");
  });
});

describe("historicoSugeridoDaLinha", () => {
  it("sem memória, cai no prefixo", () => {
    expect(historicoSugeridoDaLinha({ descricao: "ENERGIA CEMIG", match: null }))
      .toBe("PAGO ENERGIA CEMIG");
  });

  it("⚠ a memória VENCE o prefixo — é o histórico que o contador já escreveu", () => {
    const linha = {
      descricao: "ALUGUEL SALA 302",
      match: { historicoSugerido: "ALUGUEL DA SEDE — REF CONTRATO 12" },
    };
    expect(historicoSugeridoDaLinha(linha)).toBe("ALUGUEL DA SEDE — REF CONTRATO 12");
  });

  it("match SEM historicoSugerido (o estado de todos os 230 registros de hoje) cai no prefixo", () => {
    const linha = {
      descricao: "ENERGIA CEMIG",
      match: { matchType: "exact", historicoSugerido: null, contaDebito: "412" },
    };
    expect(historicoSugeridoDaLinha(linha)).toBe("PAGO ENERGIA CEMIG");
  });

  it("linha ausente ou sem descrição devolve string vazia", () => {
    expect(historicoSugeridoDaLinha(undefined)).toBe("");
    expect(historicoSugeridoDaLinha({})).toBe("");
  });
});
