// A REGRA DE TELA DA BAIXA POR DECLARAÇÃO.
//
// ⚠ O que este arquivo protege é a frase que o servidor impõe: **juros e multa são ENTRADA, e o
// total é a SOMA — nunca derivado por subtração.** A rota recusa (409 `CONFERENCIA_DIVERGENTE`)
// todo total que não bata com `principal + juros + multa`, e o `totalConferido` que sobe tem de ser
// exatamente o número que o contador leu na tela. Uma tela que "conserta" o total sozinha, ou que
// manda um total otimista com um campo ilegível, transforma a conferência em teatro.

import {
  decomporBaixa, lerAcrescimo, lancamentosPrevistos, explicarRecusa, codigoDaRecusa,
  textoDaConfirmacao, rotuloDaSituacao, MOTIVOS_BAIXA_MANUAL,
} from "../baixaManualParcela";

describe("lerAcrescimo — vazio é zero, negativo é recusa", () => {
  it("campo em branco vale ZERO e não é erro", () => {
    // Parcela paga em dia não tem acréscimo nenhum, e é o caso comum do débito automático.
    expect(lerAcrescimo("")).toMatchObject({ ok: true, valor: 0, vazio: true });
  });

  it("lê pt-BR com a gramática estrita da aba Lançamentos", () => {
    expect(lerAcrescimo("12,94").valor).toBe(12.94);
    expect(lerAcrescimo("1.234,56").valor).toBe(1234.56);
    // ⚠ Reuso, não segunda leitura: `1,234.56` é en-US e seria 1000× menor lido como brasileiro.
    expect(lerAcrescimo("1,234.56").ok).toBe(false);
  });

  it("negativo é recusado — o principal vem do contrato, não da subtração", () => {
    expect(lerAcrescimo("-5")).toMatchObject({ ok: false, erro: "acrescimo_negativo" });
  });
});

describe("decomporBaixa — a conta é feita PARA FRENTE", () => {
  const base = { valorPrevisto: 633.96 };

  it("total = principal + juros + multa", () => {
    const d = decomporBaixa({ ...base, textoJuros: "12,94", textoMulta: "1,78" });
    expect(d).toMatchObject({ ok: true, principal: 633.96, juros: 12.94, multa: 1.78, total: 648.68 });
  });

  it("sem acréscimo, o total é o principal", () => {
    expect(decomporBaixa(base).total).toBe(633.96);
  });

  // ⚠ NÃO DEVOLVE UM TOTAL OTIMISTA com um campo ilegível — seria esse número que subiria como
  // `totalConferido`, e o servidor recusaria depois de o contador já ter confirmado.
  it("campo ilegível: sem total, e o motivo fica na mão da tela", () => {
    const d = decomporBaixa({ ...base, textoJuros: "1.2.3" });
    expect(d.ok).toBe(false);
    expect(d.total).toBeNull();
    expect(d.erroJuros).toBeTruthy();
  });

  it("sem valorPrevisto: recusa NOMEADA — o principal não se inventa", () => {
    const d = decomporBaixa({ valorPrevisto: null, textoJuros: "10" });
    expect(d).toMatchObject({ ok: false, erro: "sem_valor_previsto" });
    expect(d.mensagem).toMatch(/não se inventa/i);
  });
});

describe("lancamentosPrevistos — o ato de consequência mostrado ANTES", () => {
  it("principal, juros, multa e caixa, com o efeito de cada um", () => {
    const linhas = lancamentosPrevistos(decomporBaixa({ valorPrevisto: 100, textoJuros: "5", textoMulta: "2" }));
    expect(linhas.map((l) => [l.lado, l.papel, l.valor])).toEqual([
      ["D", "PARC", 100], ["D", "JUROS", 5], ["D", "MULTA", 2], ["C", "CAIXA", 107],
    ]);
    // Só o principal amortiza o passivo — juros e multa são despesa do mês do pagamento.
    expect(linhas[0].efeito).toMatch(/amortiza o passivo/);
  });

  // O backend pula `valor <= 0`; mostrar a linha aqui prometeria um lançamento que não vai existir.
  it("componente zerado NÃO vira linha — igual ao backend", () => {
    const linhas = lancamentosPrevistos(decomporBaixa({ valorPrevisto: 100 }));
    expect(linhas.map((l) => l.papel)).toEqual(["PARC", "CAIXA"]);
  });

  it("decomposição inválida não produz prévia nenhuma", () => {
    expect(lancamentosPrevistos(decomporBaixa({ valorPrevisto: null }))).toEqual([]);
  });
});

describe("as recusas chegam à tela COM O MOTIVO", () => {
  // ⚠ Todas as sete guardas da rota. Faltando uma, ela chega como código cru e o contador não sabe
  // o que fazer — e as duas primeiras têm OUTRO caminho aberto, que precisa ser dito.
  it.each([
    "parcela_tem_guia", "parcela_ja_baixada", "MES_FECHADO", "provisao_inexistente",
    "sem_valor_previsto", "CONFERENCIA_OBRIGATORIA", "CONFERENCIA_DIVERGENTE",
  ])("%s tem texto próprio", (codigo) => {
    expect(MOTIVOS_BAIXA_MANUAL[codigo]).toBeTruthy();
    expect(explicarRecusa(codigo)).toBe(MOTIVOS_BAIXA_MANUAL[codigo]);
  });

  it("`parcela_tem_guia` APONTA a outra fila", () => {
    expect(explicarRecusa("parcela_tem_guia")).toMatch(/Parcelas pagas aguardando lançamento/);
  });

  it("`parcela_ja_baixada` aponta o estorno, que é a volta", () => {
    expect(explicarRecusa("parcela_ja_baixada")).toMatch(/estorno/i);
  });

  // ⚠ Código sem espaço em branco NÃO é frase: exibi-lo cru poria um identificador no lugar do
  // motivo (o projeto já fez isso com `serpro_pagtoweb_disabled`).
  it("código desconhecido não vira texto de tela", () => {
    expect(explicarRecusa("coisa_nova", "coisa_nova")).toMatch(/não disse por quê/);
    expect(explicarRecusa("coisa_nova", "Deu ruim de um jeito novo")).toBe("Deu ruim de um jeito novo");
  });

  // As duas formas em que a rota responde — ignorar uma apagaria metade dos motivos.
  it("lê o código tanto de `error` quanto de `motivo`", () => {
    expect(codigoDaRecusa({ code: "MES_FECHADO" })).toBe("MES_FECHADO");
    expect(codigoDaRecusa({ payload: { skipped: true, motivo: "parcela_tem_guia" } })).toBe("parcela_tem_guia");
    expect(codigoDaRecusa({})).toBeNull();
  });
});

describe("a confirmação REPETE os dados, e diz que é declaração", () => {
  const linha = {
    numeroParcela: 23, competencia: "2026-07", valorPrevisto: 633.96,
    parcelamento: { label: "OUTRO 2026 — migrado", numParcelas: 60 },
  };
  const texto = textoDaConfirmacao({
    linha,
    decomposicao: decomporBaixa({ valorPrevisto: 633.96, textoJuros: "12,94", textoMulta: "1,78" }),
    dataPagamento: "2026-08-05",
  });

  it("nomeia a prestação, o contrato e a competência", () => {
    expect(texto).toMatch(/prestação 23 de 60/);
    expect(texto).toMatch(/OUTRO 2026 — migrado/);
    expect(texto).toMatch(/competência 2026-07/);
  });

  it("repete os TRÊS valores e o total — confirmar sem repetir é confirmar o quê?", () => {
    expect(texto).toMatch(/Principal.*633,96/);
    expect(texto).toMatch(/Juros.*12,94/);
    expect(texto).toMatch(/Multa.*1,78/);
    expect(texto).toMatch(/TOTAL.*648,68/);
  });

  // ⚠ A frase que separa esta via da via da prova. Sem ela, as duas baixas parecem a mesma coisa.
  it("diz que é DECLARAÇÃO, e que fica gravada como tal", () => {
    expect(texto).toMatch(/DECLARAÇÃO sua, não um comprovante/);
    expect(texto).toMatch(/\(declarado\)/);
    expect(texto).toMatch(/MANUAL/);
  });
});

describe("o rótulo da situação vem do servidor — a tela não recalcula atraso", () => {
  it("VENCE_HOJE não é pintado como atraso", () => {
    expect(rotuloDaSituacao("VENCE_HOJE").texto).toBe("Vence hoje");
    expect(rotuloDaSituacao("VENCE_HOJE").cor).not.toBe("var(--state-warn)");
  });

  it("VENCIDA usa o âmbar de pendência", () => {
    expect(rotuloDaSituacao("VENCIDA")).toMatchObject({ texto: "Vencida", cor: "var(--state-warn)" });
  });
});
