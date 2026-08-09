import {
  montarParcelasDoAcordo, estadoBuscaParcela, textoDaConfirmacao,
  resumoDoResultado, motivoDaFalha,
} from "../parcelaBusca";

const guia = (over = {}) => ({
  id: "g1", numeroParcela: 1, valor: 1200, paymentStatus: "OPEN", baixada: false,
  competencia: "2026-06", vencimento: "2026-06-20T00:00:00.000Z",
  numeroDocumento: "07202600001001", comprovante: null,
  serproLastCheckedAt: null, serproLastCheckResult: null,
  ...over,
});

describe("montarParcelasDoAcordo — contrato × fato", () => {
  it("junta a prestação contratada com a guia dela", () => {
    const linhas = montarParcelasDoAcordo({
      numParcelas: 12,
      guides: [guia()],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, vencimento: "2026-06-20T00:00:00.000Z", guia: { id: "g1" } }],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      numeroParcela: 1, totalParcelas: 12, guideId: "g1",
      numeroDocumento: "07202600001001", valor: 1200,
    });
  });

  it("mantém a prestação SEM guia (débito automático) como linha própria", () => {
    const linhas = montarParcelasDoAcordo({
      numParcelas: 3,
      guides: [],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, vencimento: "2026-06-20T00:00:00.000Z", guia: null }],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].guideId).toBeNull();
  });

  it("não perde a guia que não casa com nenhuma prestação contratada", () => {
    const linhas = montarParcelasDoAcordo({
      numParcelas: 2,
      guides: [guia({ id: "g9", numeroParcela: 9 })],
      parcelasContratadas: [],
    });
    expect(linhas.map((l) => l.guideId)).toEqual(["g9"]);
  });

  it("acordo sem parcela nenhuma devolve lista vazia (não quebra)", () => {
    expect(montarParcelasDoAcordo(null)).toEqual([]);
    expect(montarParcelasDoAcordo({})).toEqual([]);
  });

  it("ordena por número da parcela", () => {
    const linhas = montarParcelasDoAcordo({
      guides: [],
      parcelasContratadas: [
        { id: "p3", numeroParcela: 3, guia: null },
        { id: "p1", numeroParcela: 1, guia: null },
        { id: "p2", numeroParcela: 2, guia: null },
      ],
    });
    expect(linhas.map((l) => l.numeroParcela)).toEqual([1, 2, 3]);
  });
});

describe("estadoBuscaParcela — desabilitado SEMPRE com motivo", () => {
  it("libera a busca da parcela em aberto com número de documento", () => {
    const [linha] = montarParcelasDoAcordo({
      guides: [guia()],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, guia: { id: "g1" } }],
    });
    const e = estadoBuscaParcela(linha);
    expect(e.podeBuscar).toBe(true);
    expect(e.motivo).toMatch(/PAGA/);
  });

  // ⚠ A regressão que o dono pediu: sem `numeroDocumento` o PAGTOWEB não tem o que consultar.
  it("bloqueia — com motivo — quando falta o número do documento", () => {
    const [linha] = montarParcelasDoAcordo({
      guides: [guia({ numeroDocumento: null })],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, guia: { id: "g1" } }],
    });
    const e = estadoBuscaParcela(linha);
    expect(e.podeBuscar).toBe(false);
    expect(e.motivo).toMatch(/número de documento/i);
    expect(e.motivo.length).toBeGreaterThan(20);
  });

  it("bloqueia — com motivo — a prestação sem guia capturada", () => {
    const e = estadoBuscaParcela({ guideId: null });
    expect(e.podeBuscar).toBe(false);
    expect(e.motivo).toMatch(/não tem guia capturada/i);
  });

  it("bloqueia a parcela já paga, distinguindo baixada de aguardando lançamento", () => {
    expect(estadoBuscaParcela({ guideId: "g1", paymentStatus: "PAID", baixada: true }).motivo)
      .toMatch(/baixa já lançada/i);
    expect(estadoBuscaParcela({ guideId: "g1", paymentStatus: "PAID", baixada: false }).motivo)
      .toMatch(/Falta só lançar a baixa/i);
  });

  it("nenhum bloqueio devolve motivo vazio", () => {
    const casos = [
      { guideId: null },
      { guideId: "g1", numeroDocumento: null },
      { guideId: "g1", paymentStatus: "PAID" },
      { guideId: "g1", numeroDocumento: "1" },
    ];
    for (const c of casos) expect(String(estadoBuscaParcela(c).motivo || "").trim()).not.toBe("");
  });
});

describe("textoDaConfirmacao — o ato de consequência repete os dados", () => {
  const linha = {
    numeroParcela: 3, totalParcelas: 12, numeroDocumento: "07202600001003",
    valor: 1200.5, competencia: "2026-06", serproLastCheckedAt: null,
  };

  it("repete parcela, documento, valor e competência, e avisa que é paga", () => {
    const t = textoDaConfirmacao(linha, "PARCSN 2026");
    expect(t).toContain("parcela 3/12");
    expect(t).toContain("PARCSN 2026");
    expect(t).toContain("07202600001003");
    expect(t).toContain("1.200,50");
    expect(t).toContain("2026-06");
    expect(t).toMatch(/PAGA/);
  });

  it("avisa quando a guia já foi consultada antes (o estado lido ANTES do gasto)", () => {
    const t = textoDaConfirmacao(
      { ...linha, serproLastCheckedAt: "2026-08-01T12:00:00.000Z", serproLastCheckResult: "NAO_LOCALIZADO" },
      "PARCSN 2026",
    );
    expect(t).toMatch(/já foi consultada/i);
    expect(t).toContain("NAO_LOCALIZADO");
  });
});

describe("resumoDoResultado — 'não localizado' NÃO é erro", () => {
  it("pagamento localizado sai como concluído, com data e total", () => {
    const r = resumoDoResultado({
      encontrado: true,
      comprovante: { dataArrecadacao: "13/07/2026", total: 193.03 },
    });
    expect(r.tom).toBe("ok");
    expect(r.detalhe).toContain("13/07/2026");
    expect(r.detalhe).toContain("193,03");
  });

  it("não localizado tem tom NEUTRO — distinto da falha, que é erro", () => {
    const r = resumoDoResultado({ encontrado: false, motivo: "Pagamento ainda não localizado no SERPRO." });
    expect(r.tom).toBe("neutro");
    expect(r.tom).not.toBe(motivoDaFalha(new Error("x")).tom);
    expect(r.titulo).toMatch(/ainda não localizado/i);
    expect(r.detalhe).toContain("Pagamento ainda não localizado no SERPRO.");
  });

  it("não localizado sem motivo do servidor ainda diz alguma coisa", () => {
    expect(resumoDoResultado({ encontrado: false }).detalhe).toMatch(/comprovante/i);
  });

  it("localizado sem comprovante legível avisa em vez de afirmar valores", () => {
    const r = resumoDoResultado({ encontrado: true, comprovante: null });
    expect(r.tom).toBe("ok");
    expect(r.detalhe).toMatch(/sem data\/valores legíveis/i);
  });
});

describe("motivoDaFalha — cada recusa paga chega à tela com nome próprio", () => {
  const casos = [
    ["SERPRO_CHAMADA_REPETIDA", /repetida/i],
    ["SERPRO_TETO_DIARIO", /teto diário/i],
    ["SERPRO_TETO_MENSAL_ESCRITORIO", /teto mensal/i],
    ["SERPRO_PAGTOWEB_DISABLED", /desligada/i],
    ["PAGTOWEB_FALHOU", /não respondeu/i],
  ];

  it.each(casos)("%s tem título próprio", (code, titulo) => {
    const err = new Error("mensagem real do servidor");
    err.code = code;
    const m = motivoDaFalha(err);
    expect(m.tom).toBe("erro");
    expect(m.titulo).toMatch(titulo);
    expect(m.detalhe).toBe("mensagem real do servidor");
    expect(m.code).toBe(code);
  });

  // ⚠ Caso REAL: o serviço lança `new Error("serpro_pagtoweb_disabled")`, então a "mensagem do
  // servidor" é o próprio código. Exibi-la seria pôr o nome de uma flag de ambiente no lugar da
  // explicação.
  it("mensagem que é um CÓDIGO cede lugar ao texto explicativo", () => {
    const err = new Error("serpro_pagtoweb_disabled");
    err.code = "SERPRO_PAGTOWEB_DISABLED";
    const m = motivoDaFalha(err);
    expect(m.detalhe).not.toBe("serpro_pagtoweb_disabled");
    expect(m.detalhe).toMatch(/INTEGRACAO_SERPRO_PAGTOWEB/);
  });

  it("código desconhecido e sem frase: o código viaja como contexto, não como explicação", () => {
    const m = motivoDaFalha(new Error("guide_not_found"));
    expect(m.detalhe).toMatch(/código guide_not_found/);
    expect(m.detalhe).toMatch(/sem explicação/);
  });

  it("os títulos são todos DIFERENTES — nenhuma recusa é achatada na outra", () => {
    const titulos = casos.map(([code]) => {
      const err = new Error("x");
      err.code = code;
      return motivoDaFalha(err).titulo;
    });
    expect(new Set(titulos).size).toBe(casos.length);
  });

  it("código desconhecido ainda diz algo — ausência nunca é resposta", () => {
    const m = motivoDaFalha(new Error(""));
    expect(m.tom).toBe("erro");
    expect(m.detalhe).toMatch(/não disse por quê/i);
  });

  it("usa o texto padrão quando o servidor não mandou mensagem", () => {
    const err = new Error("");
    err.code = "SERPRO_TETO_DIARIO";
    expect(motivoDaFalha(err).detalhe).toMatch(/teto de consultas pagas/i);
  });
});
