// O QUE VAI NO LOTE DE DANFSe — a página marcada, ou a competência inteira.
//
// ⚠⚠ ESTE ARQUIVO PRENDE UMA CAPACIDADE QUE QUASE SE PERDEU: o botão antigo baixava até 200 notas
// de uma vez; a seleção que o substituiu é por PÁGINA, e a página mostra 25. Sem a segunda oferta,
// quem tem 120 notas no mês passa a baixar 25 — o pedido era sobre ESCOLHER, não sobre baixar menos.

import {
  ESCOPO_DO_LOTE,
  avisoDoEscopo,
  ofertaDeTodaACompetencia,
  pedidoDoLote,
  rotuloDoBotao,
} from "../selecaoDeNotas";

describe("⚠⚠ A OFERTA DE TODA A COMPETÊNCIA — e quando ela NÃO aparece", () => {
  it("há mais notas do que a página mostra: aparece, com o número", () => {
    const o = ofertaDeTodaACompetencia({ total: 120, notasNaPagina: 25, teto: 200 });
    expect(o.total).toBe(120);
    expect(o.rotulo).toBe("Selecionar todas as 120 notas desta competência");
    expect(o.acimaDoTeto).toBe(false);
  });

  it("⚠ tudo cabe numa página: NÃO aparece — seria uma segunda porta para o mesmo ato", () => {
    expect(ofertaDeTodaACompetencia({ total: 25, notasNaPagina: 25, teto: 200 })).toBeNull();
    expect(ofertaDeTodaACompetencia({ total: 3, notasNaPagina: 3, teto: 200 })).toBeNull();
  });

  it("lista vazia não oferece nada", () => {
    expect(ofertaDeTodaACompetencia({ total: 0, notasNaPagina: 0, teto: 200 })).toBeNull();
  });

  it("⚠⚠ contagem ausente NÃO vira zero e NÃO vira oferta", () => {
    // `Number(null)` é `0`, e um zero aqui ofereceria o lote de uma lista vazia.
    for (const args of [{}, { total: null, notasNaPagina: 25 }, { total: 120, notasNaPagina: null }]) {
      expect(ofertaDeTodaACompetencia({ ...args, teto: 200 })).toBeNull();
    }
  });

  it("⚠⚠ acima do teto ela APARECE, marcada, com o MOTIVO e a SAÍDA", () => {
    // Botão que some esconde que a ação existe; o servidor recusaria com `lote_muito_grande` de
    // qualquer jeito, e descobrir isso depois de clicar é pior do que ler antes.
    const o = ofertaDeTodaACompetencia({ total: 320, notasNaPagina: 25, teto: 200 });
    expect(o.acimaDoTeto).toBe(true);
    expect(o.motivo).toMatch(/máximo 200/);
    expect(o.motivo).toMatch(/competência mais estreita|página a página/);
  });

  it("⚠ exatamente no teto ainda passa", () => {
    expect(ofertaDeTodaACompetencia({ total: 200, notasNaPagina: 25, teto: 200 }).acimaDoTeto).toBe(false);
  });
});

describe("⚠⚠ O PEDIDO — na competência NÃO vai lista de ids", () => {
  it("é a AUSÊNCIA dos ids que faz o servidor cair no filtro inteiro", () => {
    // Mandar os 120 ids exigiria buscar todas as páginas só para remontar o que o `where` já sabe,
    // e a lista poderia envelhecer entre a busca e o clique.
    const p = pedidoDoLote({ escopo: ESCOPO_DO_LOTE.COMPETENCIA, ids: ["a", "b"], competencia: "2026-07" });
    expect(p).toEqual({ competencia: "2026-07" });
    expect(p).not.toHaveProperty("ids");
  });

  it("na página os ids viajam", () => {
    expect(pedidoDoLote({ escopo: ESCOPO_DO_LOTE.PAGINA, ids: ["a", "b"], competencia: "2026-07" }))
      .toEqual({ competencia: "2026-07", ids: ["a", "b"] });
  });

  it("⚠⚠ A COMPETÊNCIA VIAJA NOS DOIS", () => {
    // Sem ela o lote da página traria o escopo certo por acaso (os ids bastam) e o da competência
    // traria o histórico inteiro.
    expect(pedidoDoLote({ escopo: ESCOPO_DO_LOTE.COMPETENCIA, competencia: "2026-07" }).competencia).toBe("2026-07");
    expect(pedidoDoLote({ escopo: ESCOPO_DO_LOTE.PAGINA, ids: ["a"], competencia: "2026-07" }).competencia).toBe("2026-07");
  });

  it("⚠ escopo desconhecido cai na PÁGINA — o estreito, nunca o largo", () => {
    // O lado seguro do erro: baixar de menos se conserta com um clique; baixar o histórico inteiro
    // de uma empresa gera um zip que ninguém pediu e estoura o teto.
    expect(pedidoDoLote({ escopo: "coisa_nova", ids: ["a"], competencia: "2026-07" }))
      .toEqual({ competencia: "2026-07", ids: ["a"] });
  });

  it("competência vazia não vira string vazia na querystring", () => {
    expect(pedidoDoLote({ escopo: ESCOPO_DO_LOTE.PAGINA, ids: ["a"], competencia: "" }).competencia).toBeUndefined();
  });
});

describe("⚠⚠ SÓ O ESCOPO DA PÁGINA PROMETE UM NÚMERO DE DANFSe", () => {
  it("na página o rótulo conta os PDFs", () => {
    expect(rotuloDoBotao({ escopo: ESCOPO_DO_LOTE.PAGINA, quantas: 3 })).toBe("Baixar 3 DANFSe");
  });

  it("⚠⚠ na competência ele conta NOTAS — e a palavra muda", () => {
    // Ali entram notas que NÃO geram DANFSe (NF-e, não confirmada pelo ADN, sem XML). Prometer
    // "Baixar 120 DANFSe" e entregar 113 é o defeito que a barra existe para não cometer.
    const r = rotuloDoBotao({ escopo: ESCOPO_DO_LOTE.COMPETENCIA, total: 120 });
    expect(r).toBe("Baixar os DANFSe destas 120 notas");
    expect(r).not.toMatch(/\d+ DANFSe/);
  });

  it("sem número, o rótulo não inventa um", () => {
    expect(rotuloDoBotao({ escopo: ESCOPO_DO_LOTE.COMPETENCIA })).toBe("Baixar os DANFSe desta competência");
    expect(rotuloDoBotao({ escopo: ESCOPO_DO_LOTE.PAGINA, quantas: 0 })).toBe("Baixar DANFSe");
  });
});

describe("⚠⚠ O AVISO DO ESCOPO — obrigatório num, proibido no outro", () => {
  it("na competência ele DIZ que o número é de notas", () => {
    const a = avisoDoEscopo(ESCOPO_DO_LOTE.COMPETENCIA);
    expect(a).toMatch(/número é de NOTAS/);
    expect(a).toMatch(/RELATORIO\.txt/);
  });

  it("⚠ na página não há nada a ressalvar — e legenda que descreve ausência foi cortada pelo dono", () => {
    expect(avisoDoEscopo(ESCOPO_DO_LOTE.PAGINA)).toBeNull();
    expect(avisoDoEscopo(undefined)).toBeNull();
  });
});
