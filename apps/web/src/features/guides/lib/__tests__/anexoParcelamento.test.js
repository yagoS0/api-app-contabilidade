// A guia como ANEXO de um parcelamento (R4).
//
// Os dois defeitos que estas regras existem para matar:
//   1. a modalidade era forçada a "SIMPLES" nos dois caminhos do modal antigo — uma parcela de
//      parcelamento de INSS era gravada com o tipo do DAS do mês;
//   2. anexar uma parcela também CONFIRMAVA o pagamento dela, com `catch {}` engolindo a falha.
//      (O segundo é de ligação, e está exercido em `renderCompanyGuidesTable`; aqui ficam as regras.)

import {
  tipoGuiaSugerido, parcelaSugerida, opcoesDeParcela, competenciaDaParcela,
  avisosDeDuplicidade, parcelamentosSelecionaveis, rotuloDoParcelamento,
  normalizarCompetencia, dataParaInput,
} from "../anexoParcelamento";

describe("⚠ o tipo da guia deixou de ser forçado a SIMPLES", () => {
  it("parcelamento de INSS sugere guia de INSS — era o caso quebrado", () => {
    expect(tipoGuiaSugerido("INSS")).toBe("INSS");
  });

  it("parcelamento do Simples/MEI é pago em DAS (tipo SIMPLES neste sistema)", () => {
    for (const m of ["PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN", "PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI"]) {
      expect(tipoGuiaSugerido(m)).toBe("SIMPLES");
    }
  });

  it("modalidade que não diz qual documento é cai em OUTRA — não em SIMPLES", () => {
    expect(tipoGuiaSugerido("OUTRO")).toBe("OUTRA");
    expect(tipoGuiaSugerido("")).toBe("OUTRA");
    expect(tipoGuiaSugerido(null)).toBe("OUTRA");
  });
});

function contrato(over = {}) {
  return {
    id: "p1", status: "ATIVO", tipo: "PARCSN", numeroParcelamento: "1234567",
    numParcelas: 60, parcelasPagas: 22, parcelasTotal: 60,
    principalPerParcela: 1200, valorParcelaReferencia: 1200,
    parcelasContratadas: [
      { numeroParcela: 22, competencia: "2026-07", vencimento: "2026-07-20T12:00:00.000Z", origemBaixa: "HISTORICO" },
      { numeroParcela: 23, competencia: "2026-08", vencimento: "2026-08-20T12:00:00.000Z", origemBaixa: null, guia: null },
      { numeroParcela: 24, competencia: "2026-09", vencimento: "2026-09-20T12:00:00.000Z", origemBaixa: null, guia: null },
    ],
    ...over,
  };
}

describe("⚠ a competência é DERIVADA — a parcela não a traz no payload", () => {
  // `SELECT_PARCELA_PARA_QUADRO` (o select real de `parcelasContratadas`) tem id, numeroParcela,
  // vencimento, origemBaixa e a guia. Ler `parcela.competencia` devolve `undefined` em produção, e
  // o campo Competência do modal nasceria vazio — obrigando a redigitar o que o contrato já sabe.
  it("deriva do vencimento CONTRATADO, que por construção cai dentro do mês da competência", () => {
    expect(competenciaDaParcela({ vencimento: "2026-08-20T12:00:00.000Z" })).toBe("2026-08");
    // dia 31 clampado para 30/09 continua sendo setembro
    expect(competenciaDaParcela({ vencimento: "2026-09-30T12:00:00.000Z" })).toBe("2026-09");
  });

  it("usa a competência explícita quando ela existir", () => {
    expect(competenciaDaParcela({ competencia: "202607", vencimento: "2026-08-20T12:00:00.000Z" })).toBe("2026-07");
  });

  it("sem vencimento e sem competência, devolve vazio — não inventa mês", () => {
    expect(competenciaDaParcela({})).toBe("");
    expect(competenciaDaParcela({ vencimento: "lixo" })).toBe("");
  });

  it("a sugestão de parcela aproveita a derivação", () => {
    const p = {
      parcelasContratadas: [
        { numeroParcela: 1, vencimento: "2026-08-20T12:00:00.000Z", origemBaixa: null, guia: null },
      ],
    };
    expect(parcelaSugerida(p).competencia).toBe("2026-08");
    expect(opcoesDeParcela(p)[0].competencia).toBe("2026-08");
  });
});

describe("o vínculo automático", () => {
  it("sugere a 1ª prestação em aberto E sem guia", () => {
    const s = parcelaSugerida(contrato());
    expect(s.numeroParcela).toBe(23);
    expect(s.competencia).toBe("2026-08");
  });

  it("pula a prestação que já tem guia", () => {
    const p = contrato();
    p.parcelasContratadas[1].guia = { id: "g1", paymentStatus: "OPEN" };
    expect(parcelaSugerida(p).numeroParcela).toBe(24);
  });

  it("contrato sem prestação livre devolve null — e a tela pede para escolher", () => {
    const p = contrato({ parcelasContratadas: [{ numeroParcela: 1, origemBaixa: "HISTORICO" }] });
    expect(parcelaSugerida(p)).toBeNull();
  });

  it("as opções de 'alterar' nomeiam o estado de cada prestação", () => {
    const ops = opcoesDeParcela(contrato());
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ numeroParcela: 22, historica: true, quitada: true, jaTemGuia: false });
    expect(ops[1]).toMatchObject({ numeroParcela: 23, historica: false, quitada: false });
  });
});

describe("⚠ duplicidade AVISA, nunca recusa — reemissão é legítima", () => {
  const guias = [
    { guideId: "g1", parcelamentoId: "p1", numeroParcela: 23, competencia: "2026-08" },
    { guideId: "g2", parcelamentoId: "outro", numeroParcela: 5, competencia: "2026-08" },
  ];

  it("acusa a prestação que já tem guia", () => {
    const a = avisosDeDuplicidade({ guias, parcelamentoId: "p1", numeroParcela: 23, competencia: "2026-08" });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/já existe uma guia vinculada à parcela 23/i);
  });

  it("acusa outra guia do MESMO contrato na mesma competência", () => {
    const a = avisosDeDuplicidade({ guias, parcelamentoId: "p1", numeroParcela: 24, competencia: "2026-08" });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/competência 2026-08/);
  });

  it("guia de OUTRO parcelamento não é duplicidade", () => {
    const a = avisosDeDuplicidade({ guias, parcelamentoId: "p1", numeroParcela: 30, competencia: "2026-12" });
    expect(a).toHaveLength(0);
  });

  it("competência em 'YYYYMM' casa com 'YYYY-MM'", () => {
    expect(normalizarCompetencia("202608")).toBe("2026-08");
    expect(normalizarCompetencia("2026-08")).toBe("2026-08");
    expect(normalizarCompetencia("lixo")).toBe("");
  });
});

describe("seleção de contratos", () => {
  it("só os ATIVOS podem receber guia", () => {
    const lista = [contrato(), contrato({ id: "p2", status: "QUITADO" }), contrato({ id: "p3", status: "RESCINDIDO" })];
    expect(parcelamentosSelecionaveis(lista).map((p) => p.id)).toEqual(["p1"]);
  });

  it("o rótulo diz modalidade, nº e progresso", () => {
    expect(rotuloDoParcelamento(contrato())).toBe("PARCSN Nº 1234567 · 22/60 pagas");
  });

  it("data ISO vira o valor do input date", () => {
    expect(dataParaInput("2026-08-20T12:00:00.000Z")).toBe("2026-08-20");
    expect(dataParaInput(null)).toBe("");
    expect(dataParaInput("lixo")).toBe("");
  });
});
