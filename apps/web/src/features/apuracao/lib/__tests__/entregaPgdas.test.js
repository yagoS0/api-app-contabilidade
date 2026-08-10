import {
  estadoEntregaPgdas, entregaPgdasDoFechamento, TOM_ENTREGA, CORES_TOM,
} from "../entregaPgdas";

// ⚠ Os números de declaração abaixo são FABRICADOS. Os reais existem no banco de produção e o
// repositório foi anonimizado — fixture entra no histórico do git para sempre.
const NUM_RFB = "11111111202601001";
const NUM_PORTAL = "22222222202601001";

describe("estadoEntregaPgdas — as origens não se equivalem", () => {
  test("transmitida por AQUI, com número: entregue pelo portal, provada", () => {
    const r = estadoEntregaPgdas({ estadoApuracao: "transmitida", numeroDeclaracaoPortal: NUM_PORTAL });
    expect(r.chave).toBe("transmitida_pelo_portal");
    expect(r.tom).toBe(TOM_ENTREGA.ok);
    expect(r.provada).toBe(true);
    expect(r.origem).toBe("portal");
    expect(r.detalhe).toContain(NUM_PORTAL);
  });

  test("número capturado do extrato: entregue FORA, provado pela RFB", () => {
    const r = estadoEntregaPgdas({
      estadoApuracao: "aberta", numeroDeclaracaoRfb: NUM_RFB,
      extratoStatus: "SUCCESS", extratoConsultadoEm: "2026-07-10T00:00:00.000Z",
    });
    expect(r.chave).toBe("capturada_da_rfb");
    expect(r.tom).toBe(TOM_ENTREGA.ok);
    expect(r.provada).toBe(true);
    expect(r.origem).toBe("rfb");
    expect(r.rotulo).toMatch(/fora do portal/i);
    expect(r.rotulo).not.toMatch(/pelo portal$/);
  });

  test("o PDF perdido não rebaixa a prova — a âncora é o número, que é coluna", () => {
    const comPdf = estadoEntregaPgdas({ numeroDeclaracaoRfb: NUM_RFB, temPdfDaDeclaracao: true });
    const semPdf = estadoEntregaPgdas({ numeroDeclaracaoRfb: NUM_RFB, temPdfDaDeclaracao: false });
    expect(semPdf.chave).toBe(comPdf.chave);
    expect(semPdf.provada).toBe(true);
    expect(comPdf.detalhe).toMatch(/PDF/);
    expect(semPdf.detalhe).not.toMatch(/PDF/);
  });

  test('"PA já declarado" (estado transmitida SEM número) não vira crédito nosso', () => {
    // `transmitirFechamento` marca "transmitida" no short-circuit do PA já declarado, e ali
    // `numeroDeclaracao` fica null — quem entregou foi outro.
    const r = estadoEntregaPgdas({ estadoApuracao: "transmitida", numeroDeclaracaoPortal: null });
    expect(r.chave).toBe("capturada_da_rfb");
    expect(r.rotulo).not.toMatch(/^Entregue pelo portal/);
  });

  test("só a afirmação do contador: DECLARADO, nunca prova", () => {
    const r = estadoEntregaPgdas({ declaradaForaEm: "2026-08-10T12:00:00.000Z" });
    expect(r.chave).toBe("declarada_fora");
    expect(r.tom).toBe(TOM_ENTREGA.declarado);
    expect(r.provada).toBe(false);
    expect(r.origem).toBe("contador");
    expect(r.rotulo).toMatch(/declarado pelo contador/i);
    expect(r.detalhe).toMatch(/extrato/i);
  });

  test("extrato NOT_FOUND depois do registro DESMENTE a afirmação", () => {
    const r = estadoEntregaPgdas({
      declaradaForaEm: "2026-08-01T00:00:00.000Z",
      extratoStatus: "NOT_FOUND", extratoConsultadoEm: "2026-08-09T00:00:00.000Z",
    });
    expect(r.chave).toBe("declarada_fora_desmentida");
    expect(r.tom).toBe(TOM_ENTREGA.nao_entregue);
    expect(r.provada).toBe(false);
  });

  test("extrato NOT_FOUND ANTERIOR ao registro não desmente nada", () => {
    // A consulta velha simplesmente não viu a entrega que veio depois. Tratar como desmentido
    // acusaria o contador com base numa foto anterior ao fato.
    const r = estadoEntregaPgdas({
      declaradaForaEm: "2026-08-09T00:00:00.000Z",
      extratoStatus: "NOT_FOUND", extratoConsultadoEm: "2026-08-01T00:00:00.000Z",
    });
    expect(r.chave).toBe("declarada_fora");
  });

  test("ninguém consultou o extrato: DESCONHECIDO, e não é o mesmo que devendo", () => {
    const r = estadoEntregaPgdas({});
    expect(r.chave).toBe("sem_informacao");
    expect(r.tom).toBe(TOM_ENTREGA.desconhecido);
    expect(r.tom).not.toBe(TOM_ENTREGA.nao_entregue);
    expect(r.origem).toBe("nenhuma");
    expect(r.detalhe).toMatch(/não é o mesmo que estar em aberto/i);
  });

  test("consultado e a Receita não tem nada: aí sim NÃO ENTREGUE", () => {
    const r = estadoEntregaPgdas({ extratoStatus: "NOT_FOUND", extratoConsultadoEm: "2026-08-09T00:00:00.000Z" });
    expect(r.chave).toBe("nao_entregue");
    expect(r.tom).toBe(TOM_ENTREGA.nao_entregue);
    expect(r.rotulo).toMatch(/NÃO entregue/);
    // O ponto da fronteira: fechar aqui não é entregar lá.
    expect(r.detalhe).toMatch(/perante a Receita/i);
  });

  test("estado sem argumento nenhum nunca é sucesso", () => {
    expect(estadoEntregaPgdas().provada).toBe(false);
  });

  test("os cinco estados têm chave, rótulo e tom coerentes entre si", () => {
    const casos = [
      { estadoApuracao: "transmitida", numeroDeclaracaoPortal: NUM_PORTAL },
      { numeroDeclaracaoRfb: NUM_RFB },
      { declaradaForaEm: "2026-08-10T00:00:00.000Z" },
      {},
      { extratoStatus: "NOT_FOUND", extratoConsultadoEm: "2026-08-09T00:00:00.000Z" },
    ].map(estadoEntregaPgdas);
    expect(new Set(casos.map((c) => c.chave)).size).toBe(5);
    expect(new Set(casos.map((c) => c.rotulo)).size).toBe(5);
    // Provado · afirmado · não sabemos · devendo — quatro tons.
    expect(new Set(casos.map((c) => c.tom)).size).toBe(4);
    // Só os dois primeiros são prova.
    expect(casos.map((c) => c.provada)).toEqual([true, true, false, false, false]);
  });

  test("todo tom tem cor de token de estado (nunca hex concatenado)", () => {
    for (const tom of Object.values(TOM_ENTREGA)) {
      expect(CORES_TOM[tom].cor).toMatch(/^var\(--state-/);
      expect(CORES_TOM[tom].fundo).toMatch(/^var\(--state-.*-surface\)$/);
    }
  });
});

describe("entregaPgdasDoFechamento — lê o payload real do getFechamento", () => {
  test("competência zerada recém-marcada, sem extrato nenhum: desconhecida", () => {
    const r = entregaPgdasDoFechamento({
      estado: "aberta",
      semFaturamento: true,
      entregaPgdas: { numeroDeclaracaoRfb: null, declaradaForaEm: null, extratoStatus: null },
    });
    expect(r.chave).toBe("sem_informacao");
  });

  test("o caso medido: 15 zeradas entregues à mão e já capturadas do extrato", () => {
    const r = entregaPgdasDoFechamento({
      estado: "aberta",
      semFaturamento: true,
      entregaPgdas: {
        numeroDeclaracaoRfb: NUM_RFB, temPdfDaDeclaracao: true,
        extratoStatus: "SUCCESS", extratoConsultadoEm: "2026-07-10T00:00:00.000Z",
      },
    });
    expect(r.chave).toBe("capturada_da_rfb");
    expect(r.provada).toBe(true);
  });

  test("payload vazio não quebra nem inventa entrega", () => {
    expect(entregaPgdasDoFechamento(null).provada).toBe(false);
    expect(entregaPgdasDoFechamento({}).chave).toBe("sem_informacao");
  });

  test("o número do snapshot é lido do snapshot, não do bloco da RFB", () => {
    const r = entregaPgdasDoFechamento({
      estado: "transmitida",
      snapshot: { estado: "transmitida", numeroDeclaracao: NUM_PORTAL },
      entregaPgdas: {},
    });
    expect(r.chave).toBe("transmitida_pelo_portal");
    expect(r.detalhe).toContain(NUM_PORTAL);
  });
});
