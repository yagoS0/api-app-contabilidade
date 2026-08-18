// SUGESTÃO DE TOMADOR — o que entra na lista e o que fica de fora.

import { buscarTomadores, listarTomadoresRecentes } from "../tomadoresRecentes";

const nota = (nome, doc) => ({ tomadorNome: nome, tomadorDoc: doc });

describe("o que vira sugestão", () => {
  it("nome + documento em forma, uma vez por documento, com a contagem", () => {
    const lista = listarTomadoresRecentes([
      nota("ACME LTDA", "12.345.678/0001-99"),
      nota("ACME LTDA", "12345678000199"),
      nota("MARIA DA SILVA", "12345678909"),
    ]);
    expect(lista).toEqual([
      { doc: "12345678000199", nome: "ACME LTDA", notas: 2 },
      { doc: "12345678909", nome: "MARIA DA SILVA", notas: 1 },
    ]);
  });

  // ⚠ Sugestão pela metade viraria nota pela metade: o documento é o que identifica o tomador.
  it("nota sem nome ou com documento fora de forma NÃO entra", () => {
    expect(listarTomadoresRecentes([
      nota(null, "12345678000199"),
      nota("SEM DOC", null),
      nota("DOC CURTO", "123"),
      nota("   ", "12345678000199"),
    ])).toEqual([]);
  });

  it("entrada ausente ou fora de forma devolve lista vazia — não quebra a tela", () => {
    expect(listarTomadoresRecentes(null)).toEqual([]);
    expect(listarTomadoresRecentes(undefined)).toEqual([]);
    expect(listarTomadoresRecentes("nada disso")).toEqual([]);
  });
});

describe("a busca", () => {
  const lista = listarTomadoresRecentes([
    nota("ACME CONSULTORIA LTDA", "12345678000199"),
    nota("BETA SERVIÇOS ME", "98765432000111"),
  ]);

  it("acha por trecho do nome, sem diferenciar caixa", () => {
    expect(buscarTomadores(lista, "consult").itens.map((i) => i.nome)).toEqual(["ACME CONSULTORIA LTDA"]);
  });

  it("acha por trecho do documento, ignorando pontuação", () => {
    expect(buscarTomadores(lista, "98.765").itens.map((i) => i.nome)).toEqual(["BETA SERVIÇOS ME"]);
  });

  it("termo vazio devolve os primeiros — é como se descobre que a sugestão existe", () => {
    expect(buscarTomadores(lista, "").total).toBe(2);
  });

  it("o total é o de verdade, mesmo com o recorte — quem corta, anuncia", () => {
    const r = buscarTomadores(lista, "", { limite: 1 });
    expect(r.itens).toHaveLength(1);
    expect(r.total).toBe(2);
  });

  it("nada encontrado é lista vazia, não a lista inteira", () => {
    expect(buscarTomadores(lista, "zzzz").itens).toEqual([]);
  });
});
