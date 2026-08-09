// As derivações do card do parcelamento (R3).
//
// ⚠ Nenhum número aqui é recalculado: `parcelasPagas`, `parcelasTotal`, `parcelasSemEvidencia` e
// `risco` vêm prontos de `decorateParcelamento`. O que este módulo acrescenta são leituras que o
// backend não tinha por que fazer — quantas quitadas são HISTÓRICAS e qual é a próxima prestação.

import {
  contarHistoricas, proximaPrestacao, restantes, textoDoProgresso,
  alertaDeAtraso, rotuloFormaPagamento, tomDoStatus, TONS_STATUS,
} from "../cartaoParcelamento";

/** O contrato do aceite: migrado na 23ª de 60, 22 prestações marcadas como HISTORICO. */
function contratoMigrado() {
  const contratadas = [];
  for (let n = 1; n <= 60; n += 1) {
    contratadas.push({
      numeroParcela: n,
      vencimento: `2024-10-20T12:00:00.000Z`,
      origemBaixa: n <= 22 ? "HISTORICO" : null,
      guia: null,
    });
  }
  return {
    id: "p1", status: "ATIVO", tipo: "PARCSN", numeroParcelamento: "1234567",
    parcelasPagas: 22, parcelasTotal: 60, parcelasSemEvidencia: 38,
    formaPagamento: "DEBITO_AUTOMATICO", diaPagamento: 20,
    parcelasContratadas: contratadas,
    risco: { avaliavel: false, nivel: null },
  };
}

describe("aceite literal — o card do contrato migrado", () => {
  const p = contratoMigrado();

  it("conta as 22 históricas", () => {
    expect(contarHistoricas(p)).toBe(22);
  });

  it("o progresso diz '22 de 60 (22 históricas)'", () => {
    const r = textoDoProgresso(p);
    expect(r.texto).toBe("22 de 60 (22 históricas)");
    expect(r.pagas).toBe(22);
    expect(r.total).toBe(60);
    expect(Math.round(r.fracao * 100)).toBe(37);
  });

  it("restam 38 prestações", () => {
    expect(restantes(p)).toBe(38);
  });

  it("a próxima prestação é a 23ª, e ela não tem guia", () => {
    const prox = proximaPrestacao(p);
    expect(prox.numeroParcela).toBe(23);
    expect(prox.temGuia).toBe(false);
  });
});

describe("progresso", () => {
  it("sem históricas, o sufixo não aparece", () => {
    const p = { parcelasPagas: 3, parcelasTotal: 12, parcelasContratadas: [] };
    expect(textoDoProgresso(p).texto).toBe("3 de 12");
  });

  it("singular de 'histórica'", () => {
    const p = {
      parcelasPagas: 1, parcelasTotal: 12,
      parcelasContratadas: [{ numeroParcela: 1, origemBaixa: "HISTORICO" }],
    };
    expect(textoDoProgresso(p).texto).toBe("1 de 12 (1 histórica)");
  });
});

describe("próxima prestação", () => {
  it("prefere o vencimento REAL da guia ao contratado", () => {
    const p = {
      parcelasContratadas: [
        { numeroParcela: 1, vencimento: "2026-01-01", origemBaixa: "HISTORICO" },
        { numeroParcela: 2, vencimento: "2026-02-01", guia: { vencimento: "2026-02-25", paymentStatus: "OPEN" } },
      ],
    };
    const prox = proximaPrestacao(p);
    expect(prox.numeroParcela).toBe(2);
    expect(prox.vencimento).toBe("2026-02-25");
    expect(prox.temGuia).toBe(true);
  });

  it("guia PAID conta como quitada", () => {
    const p = {
      parcelasContratadas: [
        { numeroParcela: 1, guia: { paymentStatus: "PAID" } },
        { numeroParcela: 2, guia: { paymentStatus: "OPEN" } },
      ],
    };
    expect(proximaPrestacao(p).numeroParcela).toBe(2);
  });

  it("contrato inteiro quitado devolve null", () => {
    const p = { parcelasContratadas: [{ numeroParcela: 1, origemBaixa: "SERPRO" }] };
    expect(proximaPrestacao(p)).toBeNull();
  });
});

describe("alerta de atraso", () => {
  const regra = { id: "IN_RFB_2063_2022_ART_18", descricao: "3 prestações", limiteAbsoluto: 3, citacaoConferida: false };

  it("⚠ sem atraso NÃO há alerta — tarja em todo card treina o olho a ignorar", () => {
    expect(alertaDeAtraso({ risco: { avaliavel: true, nivel: "ok", emAtraso: 0, regra } })).toBeNull();
  });

  it("risco não avaliável não inventa alerta", () => {
    expect(alertaDeAtraso({ risco: { avaliavel: false, nivel: "rescindivel", emAtraso: 3, regra } })).toBeNull();
  });

  it("⚠ a regra vem CONTEXTUALIZADA — diz onde ESTE contrato está dentro dela", () => {
    const a = alertaDeAtraso({ risco: { avaliavel: true, nivel: "atencao", emAtraso: 2, regra, parcelasEmAtraso: [{ numeroParcela: 5 }] } });
    expect(a.contextualizada).toBe("Rescinde com 3 em atraso — está com 2.");
    expect(a.critico).toBe(false);
    expect(a.numeros).toEqual([5]);
  });

  it("⚠ a citação legal só sai quando CONFERIDA", () => {
    const naoConferida = alertaDeAtraso({ risco: { avaliavel: true, nivel: "atencao", emAtraso: 1, regra } });
    expect(naoConferida.citacao).toBeNull();
    const conferida = alertaDeAtraso({
      risco: { avaliavel: true, nivel: "atencao", emAtraso: 1, regra: { ...regra, citacaoConferida: true } },
    });
    expect(conferida.citacao).toBe("IN_RFB_2063_2022_ART_18");
  });

  it("rescindível é crítico", () => {
    const a = alertaDeAtraso({ risco: { avaliavel: true, nivel: "rescindivel", emAtraso: 3, regra } });
    expect(a.critico).toBe(true);
    expect(a.titulo).toMatch(/risco de rescisão/i);
  });
});

describe("forma de pagamento — o terceiro estado é NÃO DECLARADO", () => {
  it("null não é 'nenhuma das duas': é ausência de declaração", () => {
    expect(rotuloFormaPagamento(null).texto).toMatch(/não declarada/i);
    expect(rotuloFormaPagamento("DEBITO_AUTOMATICO").texto).toBe("Débito automático");
    expect(rotuloFormaPagamento("GUIA_MENSAL").texto).toBe("Guia mensal");
  });
});

describe("cores de status", () => {
  it("⚠ ATIVO NÃO é verde — verde significa CONCLUÍDO neste app", () => {
    expect(tomDoStatus("ATIVO").cor).toBe("var(--state-neutral)");
    expect(tomDoStatus("QUITADO").cor).toBe("var(--state-ok)");
    expect(tomDoStatus("RESCINDIDO").cor).toBe("var(--state-danger)");
  });

  it("⚠ todo tom tem par `-surface` — nada de concatenar hex", () => {
    for (const tom of Object.values(TONS_STATUS)) {
      expect(tom.fundo).toMatch(/^var\(--.*-surface\)$/);
      expect(tom.cor).toMatch(/^var\(--/);
    }
  });

  it("status desconhecido não quebra", () => {
    expect(tomDoStatus(undefined)).toBe(TONS_STATUS.ATIVO);
  });
});
