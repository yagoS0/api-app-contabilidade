// A LISTA DA LC 116/2003 — a tabela e o que ela se recusa a responder.
//
// ⚠ ESTES TESTES CONFEREM CONTRA A LEI, não contra o próprio gerador. O que amarra a extração é o
// gate do `gerar-lista-lc116.mjs` (contagens + numeração contígua, que ABORTA na divergência);
// aqui se prende o CONTRATO de leitura e as três coisas que este módulo não pode passar a fazer.

import {
  ITENS_LC116, SUBITENS_LC116,
  normalizarCodigoLc116, subitemLc116, descricaoLc116, descricaoItemLc116, subitensDoItem,
} from "../index.js";

describe("⚠ a tabela veio inteira, e a prova é ESTRUTURAL", () => {
  it("40 itens e 205 subitens", () => {
    expect(Object.keys(ITENS_LC116)).toHaveLength(40);
    expect(SUBITENS_LC116).toHaveLength(205);
  });

  it("⚠⚠ a numeração de cada item é CONTÍGUA, de .01 até o último — sem buraco", () => {
    // Contagem sozinha fecha por acaso: uma entrada perdida e outra duplicada dão o mesmo total.
    // Foi ESTA prova que decidiu o número — uma primeira sondagem achou 204 e estava colando uma
    // entrada no texto da anterior, em silêncio.
    for (let item = 1; item <= 40; item += 1) {
      const subs = subitensDoItem(item).map((s) => Number(s.subitem));
      expect(subs.length).toBeGreaterThan(0);
      expect(subs).toEqual(Array.from({ length: subs.length }, (_, i) => i + 1));
    }
  });

  it("⚠ os 5 VETADOS estão presentes e MARCADOS — não sumiram da numeração", () => {
    const vetados = SUBITENS_LC116.filter((s) => s.vetado).map((s) => s.codigo);
    expect(vetados).toEqual(["3.01", "7.14", "7.15", "13.01", "17.07"]);
    for (const c of vetados) expect(subitemLc116(c).descricao).toBeNull();
  });

  it("⚠⚠ a redação da LC 157/2016 VENCEU a original", () => {
    // O texto compilado do Planalto traz as DUAS, interleavadas. Guardar a última escrita daria a
    // REVOGADA — descrição revogada em documento fiscal é erro silencioso.
    expect(subitemLc116("1.03").descricao).toMatch(/armazenamento ou hospedagem/i);
    expect(subitemLc116("1.03").descricao).not.toBe("Processamento de dados e congêneres.");
    expect(subitemLc116("11.02").descricao).toMatch(/semoventes/i);
  });

  it("⚠ os acentos sobreviveram — a fonte é latin-1, não utf-8", () => {
    expect(subitemLc116("1.01").descricao).toBe("Análise e desenvolvimento de sistemas.");
    expect(SUBITENS_LC116.every((s) => !/�/.test(s.descricao || ""))).toBe(true);
  });

  it("⚠ não sobrou nota legislativa dentro da descrição", () => {
    const sujas = SUBITENS_LC116.filter((s) => /Reda[çc][ãa]o dada|Inclu[íi]do pela/i.test(s.descricao || ""));
    expect(sujas.map((s) => s.codigo)).toEqual([]);
  });

  it("o item que o dono citou na avaliação sai com o texto da lei", () => {
    expect(descricaoLc116("17.06")).toMatch(/^17\.06 — Propaganda e publicidade/);
  });
});

describe("⚠ NORMALIZAÇÃO — tolerante na entrada, nunca inventiva", () => {
  it.each([["1.06", "1.06"], ["01.06", "1.06"], [" 1 . 6 ", "1.06"], ["17.6", "17.06"]])(
    "%p vira %p", (bruto, esperado) => expect(normalizarCodigoLc116(bruto)).toBe(esperado),
  );

  it.each(["", null, undefined, "abc", "1", "1.", "410105", "41.01", "0.01", "1.2.3"])(
    "⚠ %p NÃO vira código — fora do formato devolve null",
    (bruto) => expect(normalizarCodigoLc116(bruto)).toBeNull(),
  );

  it("⚠⚠ `410105` (um cTribNac de 6 dígitos) não é aceito como item da LC 116", () => {
    // São listas DIFERENTES, com granularidades diferentes. Aceitar um pelo outro dá o serviço
    // errado, e o erro sai como nota emitida — silenciosamente.
    expect(normalizarCodigoLc116("410105")).toBeNull();
    expect(subitemLc116("410105")).toBeNull();
  });
});

describe("⚠⚠ TRÊS RESPOSTAS NA DESCRIÇÃO, e a do meio impede a mentira", () => {
  it("código conhecido devolve o texto da lei", () => {
    expect(descricaoLc116("1.01")).toBe("1.01 — Análise e desenvolvimento de sistemas.");
  });

  it("⚠ código VETADO diz que é vetado — não devolve o número sozinho", () => {
    // O subitem existe na numeração e NÃO é serviço tributável. Mostrar só o número sugeriria um
    // serviço que a lei recusou.
    expect(descricaoLc116("3.01")).toMatch(/\(VETADO/);
  });

  it("⚠ código INEXISTENTE devolve null — a tela mostra o código cru e diz que não o reconhece", () => {
    expect(descricaoLc116("1.99")).toBeNull();
    expect(descricaoLc116("41.01")).toBeNull();
  });
});

describe("⚠⚠ O QUE ESTE MÓDULO SE RECUSA A FAZER", () => {
  // A LC 116 é a lista do ISS. Anexo do Simples é a LC 123; presunção é a Lei 9.249. O de-para
  // entre elas é julgamento fiscal que não está em norma nenhuma — e errá-lo põe receita no anexo
  // errado EM SÉRIE. Se alguém acrescentar isto aqui, este teste cai e a decisão fica à vista.
  it("nenhum subitem carrega anexo, tipo de receita ou presunção", () => {
    const proibidos = ["anexo", "tipoReceita", "presuncao", "irpj", "csll", "aliquota"];
    for (const s of SUBITENS_LC116.slice(0, 20)) {
      for (const p of proibidos) expect(s).not.toHaveProperty(p);
    }
  });

  it("o módulo não exporta nada que decida anexo", () => {
    expect(descricaoItemLc116(17)).toMatch(/^Serviços de/);
    expect(descricaoItemLc116(99)).toBeNull();
    expect(descricaoItemLc116("x")).toBeNull();
  });
});
