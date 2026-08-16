import {
  montarParcelasDoAcordo, estadoBuscaParcela, textoDaConfirmacao,
  resumoDoResultado, motivoDaFalha, agruparBloqueios, resumoDosNumeros,
  situacaoDaLinha, valorDaLinha,
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

// ⚠ INCIDENTE DE PRODUÇÃO. "Sem guia" não quer dizer a mesma coisa nos três contratos, e o dono
// foi explícito: *"alguns parcelamentos, ainda mais no Lucro Presumido, não vão ter parcelas pois
// são em débito automático"*. Mandar esse contador esperar a captura do SERPRO é mandá-lo esperar
// um documento que nunca vai chegar.
describe("sem guia — o motivo depende da FORMA DE PAGAMENTO do contrato", () => {
  const semGuia = (formaPagamento) => {
    const [linha] = montarParcelasDoAcordo({
      formaPagamento,
      guides: [],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, vencimento: null, guia: null }],
    });
    return estadoBuscaParcela(linha);
  };

  it("a forma de pagamento do CONTRATO chega à linha", () => {
    const [linha] = montarParcelasDoAcordo({
      formaPagamento: "DEBITO_AUTOMATICO",
      guides: [],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, guia: null }],
    });
    expect(linha.formaPagamento).toBe("DEBITO_AUTOMATICO");
  });

  it("débito automático NÃO manda esperar guia nenhuma — ela não existe e não vai existir", () => {
    const e = semGuia("DEBITO_AUTOMATICO");
    expect(e.podeBuscar).toBe(false);
    expect(e.motivo).toMatch(/débito automático/i);
    expect(e.motivo).toMatch(/não vai existir/i);
    // A regressão que importa: nada de "capture no SERPRO" nem "suba na aba Guias".
    expect(e.motivo).not.toMatch(/captura do SERPRO/i);
    expect(e.motivo).not.toMatch(/upload na aba Guias/i);
  });

  it("guia mensal manda capturar, porque ali a guia realmente vai chegar", () => {
    const e = semGuia("GUIA_MENSAL");
    expect(e.motivo).toMatch(/captura do SERPRO/i);
    expect(e.motivo).toMatch(/aba Guias/i);
  });

  // ⚠ `null` é o DEFAULT do backend e o valor de todo contrato anterior a `139c4efe`. Não se
  // inventa qual é: o texto diz os dois desfechos e o que separa um do outro.
  it("forma não declarada não afirma nenhum dos dois — diz os dois", () => {
    const e = semGuia(null);
    expect(e.motivo).toMatch(/não foi declarada/i);
    expect(e.motivo).toMatch(/débito automático/i);
    expect(e.motivo).toMatch(/guia mensal/i);
  });

  it("todo bloqueio tem rótulo curto para a linha, além do texto inteiro", () => {
    for (const forma of ["DEBITO_AUTOMATICO", "GUIA_MENSAL", null]) {
      const e = semGuia(forma);
      expect(String(e.rotulo || "").trim()).not.toBe("");
      expect(e.rotulo.length).toBeLessThan(e.motivo.length);
    }
    expect(estadoBuscaParcela({ guideId: "g1", numeroDocumento: null }).rotulo).toMatch(/documento/i);
    expect(estadoBuscaParcela({ guideId: "g1", paymentStatus: "PAID" }).rotulo).toMatch(/baixa/i);
  });
});

// ⚠ 60 prestações sem guia repetiam o MESMO parágrafo 60 vezes num card de 360px. O texto estava
// certo; estava 60 vezes. Agrupar tira a repetição, não a informação.
describe("agruparBloqueios — o motivo uma vez, dizendo em quais prestações vale", () => {
  const acordo = (over) => montarParcelasDoAcordo({
    numParcelas: 60,
    guides: [],
    parcelasContratadas: Array.from({ length: 60 }, (_, i) => ({
      id: `p${i + 1}`, numeroParcela: i + 1, guia: null,
    })),
    ...over,
  });

  it("60 prestações no mesmo estado viram UM grupo, com a contagem", () => {
    const grupos = agruparBloqueios(acordo());
    expect(grupos).toHaveLength(1);
    expect(grupos[0].quantidade).toBe(60);
    expect(grupos[0].numeros).toHaveLength(60);
  });

  it("estados diferentes ficam em grupos diferentes, cada um com suas prestações", () => {
    const linhas = montarParcelasDoAcordo({
      formaPagamento: "GUIA_MENSAL",
      guides: [
        guia({ id: "g1", numeroParcela: 1, paymentStatus: "PAID", baixada: true }),
        guia({ id: "g2", numeroParcela: 2, numeroDocumento: null }),
      ],
      parcelasContratadas: [
        { id: "p1", numeroParcela: 1, guia: { id: "g1" } },
        { id: "p2", numeroParcela: 2, guia: { id: "g2" } },
        { id: "p3", numeroParcela: 3, guia: null },
      ],
    });
    const grupos = agruparBloqueios(linhas);
    expect(grupos).toHaveLength(3);
    expect(grupos.map((g) => g.numeros)).toEqual([[1], [2], [3]]);
  });

  // A linha que PODE buscar não é bloqueio nenhum — não vira grupo.
  it("prestação liberada não entra em grupo nenhum", () => {
    const linhas = montarParcelasDoAcordo({
      guides: [guia()],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, guia: { id: "g1" } }],
    });
    expect(agruparBloqueios(linhas)).toEqual([]);
  });

  it("não quebra com entrada vazia", () => {
    expect(agruparBloqueios(null)).toEqual([]);
    expect(agruparBloqueios([])).toEqual([]);
  });
});

// ⚠ O que é cortado é DITO. Um "…" mudo esconderia quantas prestações ficaram de fora.
describe("resumoDosNumeros — o corte é anunciado, nunca silencioso", () => {
  it("lista tudo quando cabe", () => {
    expect(resumoDosNumeros([1, 2, 3])).toBe("1, 2, 3");
  });

  it("acima do limite diz quantas sobraram", () => {
    expect(resumoDosNumeros(Array.from({ length: 60 }, (_, i) => i + 1), 8))
      .toBe("1, 2, 3, 4, 5, 6, 7, 8 e mais 52");
  });

  it("ignora prestação sem número em vez de imprimir 'null'", () => {
    expect(resumoDosNumeros([1, null, 3])).toBe("1, 3");
    expect(resumoDosNumeros([])).toBe("");
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ O ACORDEÃO CONTRADIZIA O CARD LOGO ACIMA — e a distância entre as duas afirmações era 200px.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Num contrato MIGRADO (as N primeiras prestações vêm `origemBaixa: "HISTORICO"`, F2.3) o card diz
// "22 de 60 (22 históricas)" e "VALOR DA PARCELA R$ 1.200,00". Abrindo o acordeão, as MESMAS 22
// apareciam como "sem guia", valor "—", idênticas às 38 que nunca foram pagas — cada uma com um
// botão "🔎 Buscar pagamento" (consulta PAGA ao SERPRO) e o motivo mandando capturar a guia de uma
// prestação já quitada.
//
// A causa: `linhaDaParcela` montava a linha SÓ pela guia. `origemBaixa` (o predicado de quitação
// que `parcelaRowQuitada` já usa no backend e que `cartaoParcelamento.contarHistoricas` já lê para
// o card) e `valorPrevisto` nem chegavam à linha, embora os dois venham no
// `SELECT_PARCELA_PARA_QUADRO` desde a F2.3.
const CONTRATO_MIGRADO = {
  numParcelas: 60,
  formaPagamento: "DEBITO_AUTOMATICO",
  guides: [],
  parcelasContratadas: Array.from({ length: 60 }, (_, i) => ({
    id: `p${i + 1}`,
    numeroParcela: i + 1,
    competencia: "2026-01",
    vencimento: "2026-01-20T12:00:00.000Z",
    valorPrevisto: 1200,
    origemBaixa: i < 22 ? "HISTORICO" : null,
    guia: null,
  })),
};

describe("a linha carrega o CONTRATO, não só a guia", () => {
  it("`origemBaixa` e `valorPrevisto` chegam à linha", () => {
    const linhas = montarParcelasDoAcordo(CONTRATO_MIGRADO);
    expect(linhas[0].origemBaixa).toBe("HISTORICO");
    expect(linhas[0].valorPrevisto).toBe(1200);
    expect(linhas[59].origemBaixa).toBeNull();
    expect(linhas[59].valorPrevisto).toBe(1200);
  });

  it("a competência CONTRATADA entra quando não há guia", () => {
    expect(montarParcelasDoAcordo(CONTRATO_MIGRADO)[0].competencia).toBe("2026-01");
  });

  it("guia sem prestação contratada continua sem `origemBaixa` nem valor previsto", () => {
    const [l] = montarParcelasDoAcordo({ guides: [guia({ id: "g9", numeroParcela: 9 })], parcelasContratadas: [] });
    expect(l.origemBaixa).toBeNull();
    expect(l.valorPrevisto).toBeNull();
  });
});

// ⚠ SÃO DOIS FATOS DIFERENTES. `guia.valor` é o que o documento diz; `valorPrevisto` é o que o
// contrato contratou. A coluna mostra o segundo quando o primeiro não existe — e DIZ qual é.
describe("valorDaLinha — o número da coluna Valor, COM a procedência", () => {
  it("com guia, o valor é o do DOCUMENTO", () => {
    const [l] = montarParcelasDoAcordo({
      guides: [guia({ valor: 1350.75 })],
      parcelasContratadas: [{ id: "p1", numeroParcela: 1, valorPrevisto: 1200, guia: { id: "g1" } }],
    });
    expect(valorDaLinha(l)).toEqual({ valor: 1350.75, fonte: "guia" });
  });

  it("⚠ SEM guia, o valor CONTRATADO deixa de virar '—' — era a contradição com o card", () => {
    const linhas = montarParcelasDoAcordo(CONTRATO_MIGRADO);
    expect(valorDaLinha(linhas[0])).toEqual({ valor: 1200, fonte: "contrato" });
    expect(linhas.every((l) => valorDaLinha(l).valor === 1200)).toBe(true);
  });

  it("sem nenhum dos dois continua sem valor — ausência não é zero", () => {
    expect(valorDaLinha({ valor: null, valorPrevisto: null })).toEqual({ valor: null, fonte: null });
    expect(valorDaLinha(null)).toEqual({ valor: null, fonte: null });
  });

  it("`valorPrevisto: 0` (o contrato que o wizard produzia) é 0, não ausência", () => {
    expect(valorDaLinha({ valor: null, valorPrevisto: 0 })).toEqual({ valor: 0, fonte: "contrato" });
  });
});

// ⚠ AS TRÊS RESPOSTAS. `HISTORICO` é QUITADA e **não tem lançamento contábil** (F2.3) — chamá-la de
// "baixada" mandaria alguém procurar no razão uma baixa que não existe. `MANUAL` é baixada de
// verdade, pela declaração. "Sem guia" é a prestação que ainda não foi nem paga nem declarada.
describe("situacaoDaLinha — quitada (histórica) × baixada (declarada) × sem guia", () => {
  const sit = (over) => situacaoDaLinha({ guideId: null, ...over });

  it("as três têm textos DIFERENTES — nenhuma é achatada na outra", () => {
    const textos = [
      sit({ origemBaixa: "HISTORICO" }).texto,
      sit({ origemBaixa: "MANUAL" }).texto,
      sit({}).texto,
    ];
    expect(new Set(textos).size).toBe(3);
  });

  it("a histórica é QUITADA e diz que não há lançamento nosso", () => {
    const s = sit({ origemBaixa: "HISTORICO" });
    expect(s.texto).toMatch(/quitada/i);
    expect(s.texto).toMatch(/histórica/i);
    expect(s.detalhe).toMatch(/sem lançamento/i);
    expect(s.cor).toBe("var(--state-ok)");
  });

  it("a declarada é BAIXADA, e o detalhe diz que a evidência é declaração", () => {
    const s = sit({ origemBaixa: "MANUAL" });
    expect(s.texto).toMatch(/baixada/i);
    expect(s.texto).toMatch(/declarada/i);
    expect(s.detalhe).toMatch(/declaração/i);
  });

  it("`DEBITO_AUTOMATICO` (a via da PROVA, ainda não implementada) já tem rótulo próprio", () => {
    expect(sit({ origemBaixa: "DEBITO_AUTOMATICO" }).texto).toMatch(/débito automático/i);
  });

  // ⚠ O vocabulário é cópia declarada de `ancoraBaixa.ORIGENS_BAIXA_PARCELA`. Uma via nova gravada
  // no backend sem passar por aqui não pode virar "sem guia" — isso apagaria a quitação.
  it("origem desconhecida ainda é QUITADA, nomeando a origem", () => {
    const s = sit({ origemBaixa: "VIA_NOVA" });
    expect(s.texto).toMatch(/quitada/i);
    expect(s.detalhe).toMatch(/VIA_NOVA/);
  });

  it("os estados por GUIA continuam como estavam", () => {
    expect(situacaoDaLinha({ guideId: "g1", baixada: true }).texto).toBe("baixada");
    expect(situacaoDaLinha({ guideId: "g1", paymentStatus: "PAID" }).texto).toMatch(/falta lançar/);
    expect(situacaoDaLinha({ guideId: "g1" }).texto).toBe("em aberto");
    expect(sit({}).texto).toBe("sem guia");
  });
});

// ⚠ NÃO SE OFERECE CONSULTA PAGA SOBRE PRESTAÇÃO JÁ QUITADA. Antes, a quitada sem guia caía no ramo
// "sem guia capturada" e o texto mandava capturá-la no SERPRO — a chamada é paga, e a prestação já
// está paga.
describe("estadoBuscaParcela — a quitação é lida ANTES da ausência de guia", () => {
  it("a histórica bloqueia dizendo que já foi paga, não que falta capturar guia", () => {
    const [l] = montarParcelasDoAcordo(CONTRATO_MIGRADO);
    const e = estadoBuscaParcela(l);
    expect(e.podeBuscar).toBe(false);
    expect(e.motivo).toMatch(/já paga|quitada/i);
    expect(e.motivo).not.toMatch(/captura do SERPRO/i);
    expect(e.motivo).not.toMatch(/upload na aba Guias/i);
    expect(e.rotulo).toMatch(/quitada/i);
  });

  it("a declarada bloqueia como baixa já lançada", () => {
    const e = estadoBuscaParcela({ guideId: null, origemBaixa: "MANUAL" });
    expect(e.podeBuscar).toBe(false);
    expect(e.rotulo).toMatch(/baixa já lançada/i);
  });

  it("a prestação AINDA em aberto continua com o motivo de 'sem guia' do contrato", () => {
    const linhas = montarParcelasDoAcordo(CONTRATO_MIGRADO);
    const e = estadoBuscaParcela(linhas[59]);
    expect(e.podeBuscar).toBe(false);
    expect(e.motivo).toMatch(/débito automático/i);
  });

  // O efeito na tela: 22 + 38 deixam de ser um bloco só de 60 "sem guia capturada".
  it("⚠ o acordeão passa a ter DOIS grupos, com 22 e 38 — não um de 60", () => {
    const grupos = agruparBloqueios(montarParcelasDoAcordo(CONTRATO_MIGRADO));
    expect(grupos.map((g) => g.quantidade).sort((a, b) => a - b)).toEqual([22, 38]);
  });
});
