// A CONTA DO LÍQUIDO — e, sobretudo, o que ela se RECUSA a afirmar.
//
// O defeito que estes casos trancam é sempre o mesmo, em roupas diferentes: transformar ausência em
// zero. `R$ 0,00` num campo que ninguém preencheu é uma frase sobre a nota — e uma frase falsa.

import { calcularTributosDaNota, dinheiroOuTraco, paraNumero } from "../tributosDaNota";

describe("paraNumero — pt-BR sem inventar", () => {
  it("aceita vírgula decimal, ponto de milhar e número", () => {
    expect(paraNumero("1.234,56")).toBe(1234.56);
    expect(paraNumero("1234.56")).toBe(1234.56);
    expect(paraNumero(1234.56)).toBe(1234.56);
  });

  it("⚠ vazio continua VAZIO — nunca zero", () => {
    expect(paraNumero("")).toBeNull();
    expect(paraNumero("   ")).toBeNull();
    expect(paraNumero(null)).toBeNull();
    expect(paraNumero(undefined)).toBeNull();
    expect(paraNumero("abc")).toBeNull();
  });
});

describe("dinheiroOuTraco", () => {
  it("⚠ null vira travessão, NUNCA R$ 0,00", () => {
    expect(dinheiroOuTraco(null)).toBe("—");
    expect(dinheiroOuTraco(undefined)).toBe("—");
    // Zero INFORMADO é outra coisa: aí a afirmação é do contador, e ela aparece.
    expect(dinheiroOuTraco(0)).toContain("0,00");
  });
});

describe("o ISS", () => {
  it("sai de valor × alíquota quando os dois foram informados", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "2" });
    expect(t.iss).toBeCloseTo(30, 6);
    expect(t.motivoIss).toBeNull();
  });

  it("⚠ alíquota em branco NÃO é alíquota zero — o ISS fica desconhecido, com o motivo", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "" });
    expect(t.iss).toBeNull();
    expect(t.motivoIss).toMatch(/a da prefeitura/);
  });

  it("sem valor não há ISS, e o motivo é o valor", () => {
    const t = calcularTributosDaNota({ valor: "", aliquota: "2" });
    expect(t.iss).toBeNull();
    expect(t.motivoIss).toMatch(/valor do serviço/);
  });
});

describe("o líquido", () => {
  // ⚠ Esta é a única regra "fiscal" do módulo, e ela já estava escrita em palavras em
  // `textoIssRetido`: com retenção, o prestador recebe o valor menos o ISS.
  it("com ISS retido, o tomador retém: líquido = valor − ISS", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "2", issRetido: true });
    expect(t.liquido).toBeCloseTo(1470, 6);
  });

  it("sem retenção o tomador paga o valor cheio — e a tela DIZ que o ISS não sai do líquido", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "2", issRetido: false });
    expect(t.liquido).toBeCloseTo(1500, 6);
    expect(t.naoSaemDoLiquido.map((l) => l.rotulo)).toContain("ISS");
    expect(t.naoSaemDoLiquido[0].motivo).toMatch(/quem recolhe o ISS é o prestador/);
  });

  it("⚠ retenção sem alíquota NÃO vira 'líquido = valor' — vira ausência com motivo", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "", issRetido: true });
    expect(t.liquido).toBeNull();
    expect(t.motivoLiquido).toMatch(/alíquota/);
  });

  it("sem valor não há líquido", () => {
    const t = calcularTributosDaNota({});
    expect(t.liquido).toBeNull();
    expect(t.valor).toBeNull();
    expect(t.motivoLiquido).toMatch(/valor do serviço/);
  });

  it("valor zero ou negativo não é valor de nota", () => {
    expect(calcularTributosDaNota({ valor: "0" }).valor).toBeNull();
    expect(calcularTributosDaNota({ valor: "-5" }).valor).toBeNull();
  });
});

describe("o que NÃO sai do líquido", () => {
  it("o percentual do Simples entra na lista quando informado — informativo, não retido", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "2", issRetido: true, pTotTribSN: 6.84 });
    const rotulos = t.naoSaemDoLiquido.map((l) => l.rotulo);
    expect(rotulos).toContain("Total de tributos do Simples");
    // Com retenção o ISS SAI do líquido, então ele não pode aparecer nesta lista.
    expect(rotulos).not.toContain("ISS");
  });

  it("sem percentual informado a linha não é inventada", () => {
    const t = calcularTributosDaNota({ valor: "1500", aliquota: "2", issRetido: true });
    expect(t.naoSaemDoLiquido).toHaveLength(0);
  });
});
