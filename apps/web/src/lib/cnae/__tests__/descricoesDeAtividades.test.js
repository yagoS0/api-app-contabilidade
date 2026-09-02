// A LEGENDA DO CNAE NA EDIÇÃO — ler o que está gravado, nunca inventar.
//
// ⚠ As formas abaixo são as MEDIDAS em produção (30/08/2026): 12 de 34 empresas têm linha
// descrita, 65 linhas são código nu.

import {
  descricaoDaLinha,
  descricoesGravadas,
  fundirDescricoes,
  normalizarCnae,
  temDescricao,
} from "../descricoesDeAtividades";

describe("normalizarCnae — tem de bater com o do backend", () => {
  test("as duas formas de produção dão o mesmo código", () => {
    expect(normalizarCnae("4619200")).toBe("4619200");
    expect(normalizarCnae("46.19-2-00")).toBe("4619200");
    // ⚠ Os 7 PRIMEIROS dígitos, mesmo com números na descrição.
    expect(normalizarCnae("46.19-2-00 - Representantes 24 horas")).toBe("4619200");
  });

  test("o que não tem 7 dígitos não vira código", () => {
    expect(normalizarCnae("123")).toBeNull();
    expect(normalizarCnae("")).toBeNull();
    expect(normalizarCnae(null)).toBeNull();
  });
});

describe("temDescricao / descricaoDaLinha", () => {
  test("código nu não tem descrição, nas duas formas", () => {
    expect(temDescricao("4619200")).toBe(false);
    expect(temDescricao("46.19-2-00")).toBe(false);
    expect(descricaoDaLinha("4619200")).toBeNull();
  });

  test("o texto sai sem o código na frente", () => {
    expect(descricaoDaLinha("46.19-2-00 - Representantes comerciais")).toBe("Representantes comerciais");
    expect(descricaoDaLinha("8220200 - Atividades de teleatendimento (Dispensada *)"))
      .toBe("Atividades de teleatendimento (Dispensada *)");
  });

  test("⚠ devolve null, nunca string vazia — vazio se leria como 'descrição em branco'", () => {
    expect(descricaoDaLinha("4619200 - ")).toBeNull();
    expect(descricaoDaLinha("")).toBeNull();
  });
});

describe("descricoesGravadas", () => {
  test("monta o mapa a partir do que está no banco — o caso da edição", () => {
    const mapa = descricoesGravadas([
      "46.19-2-00 - Representantes comerciais",
      "6201500",
    ]);
    expect(mapa.get("4619200")).toBe("Representantes comerciais");
    // ⚠⚠ CÓDIGO NU NÃO ENTRA. Uma chave sem texto faria a legenda dizer "consultei e não achei".
    expect(mapa.has("6201500")).toBe(false);
  });

  test("entrada vazia não fabrica nada", () => {
    expect(descricoesGravadas(null).size).toBe(0);
    expect(descricoesGravadas([]).size).toBe(0);
    expect(descricoesGravadas(["", "  ", "123"]).size).toBe(0);
  });

  test("a primeira descrição do código vence — não há empate silencioso", () => {
    const mapa = descricoesGravadas(["4619200 - Primeira", "46.19-2-00 - Segunda"]);
    expect(mapa.get("4619200")).toBe("Primeira");
  });
});

describe("fundirDescricoes", () => {
  test("⚠ A CONSULTA VENCE o gravado: ela é a fonte oficial e é mais nova", () => {
    const gravadas = new Map([["4619200", "Nome antigo"]]);
    const consulta = new Map([["4619200", "Nome oficial de hoje"]]);
    expect(fundirDescricoes(gravadas, consulta).get("4619200")).toBe("Nome oficial de hoje");
  });

  test("sem consulta (o caso da EDIÇÃO), o gravado é o que aparece", () => {
    const gravadas = new Map([["4619200", "Representantes"]]);
    expect(fundirDescricoes(gravadas, new Map()).get("4619200")).toBe("Representantes");
    expect(fundirDescricoes(gravadas, null).get("4619200")).toBe("Representantes");
  });

  test("a consulta acrescenta código que não estava gravado", () => {
    const saida = fundirDescricoes(new Map(), new Map([["6201500", "Desenvolvimento de software"]]));
    expect(saida.get("6201500")).toBe("Desenvolvimento de software");
  });
});
