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
  agruparBloqueiosDaFila, tituloDoGrupo, rotuloDoBloqueio,
  planoDoLoteDeValor, textoDaConfirmacaoDoLote,
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

  // ⚠ O par `-surface` VEM DA REGRA, não do componente: o estado virou badge, badge precisa de
  // fundo, e derivar fundo no JSX repõe o truque `${cor}22`, que quebra em silêncio com `var()`.
  it("todo estado traz o par -surface do token", () => {
    expect(rotuloDaSituacao("VENCIDA").fundo).toBe("var(--state-warn-surface)");
    expect(rotuloDaSituacao("VENCE_HOJE").fundo).toBe("var(--state-neutral-surface)");
  });
});

// ─── A FILA AGRUPADA (Fase 1) ───────────────────────────────────────────────────────────────────
//
// ⚠ O QUE ESTES TESTES PROTEGEM não é o layout, é a FRONTEIRA: some a repetição, nunca a linha nem
// o motivo. Num contrato criado pelo wizard TODAS as prestações nascem com `sem_valor_previsto`, e
// o mesmo parágrafo repetido linha a linha não se lê — vira textura. Agrupado, ele aparece uma vez,
// dizendo em quantas prestações vale e quais são; e é o agrupamento que dá lugar à ação em lote.

const linhaDaFila = (over = {}) => ({
  parcelaId: "p1", numeroParcela: 1, competencia: "2026-05", vencimento: "2026-05-20T12:00:00.000Z",
  valorPrevisto: 0, situacao: "VENCIDA", parcelamentoId: "c1",
  parcelamento: { id: "c1", label: "PARCSN 2026", numParcelas: 3 },
  podeBaixar: false, motivoBloqueio: "sem_valor_previsto",
  ...over,
});

describe("agruparBloqueiosDaFila — o motivo UMA vez, por motivo e por CONTRATO", () => {
  it("três prestações do mesmo contrato viram UM grupo, com as três nomeadas", () => {
    const grupos = agruparBloqueiosDaFila([
      linhaDaFila({ parcelaId: "p1", numeroParcela: 1 }),
      linhaDaFila({ parcelaId: "p2", numeroParcela: 2 }),
      linhaDaFila({ parcelaId: "p3", numeroParcela: 3 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].quantidade).toBe(3);
    expect(grupos[0].numeros).toEqual([1, 2, 3]);
    expect(grupos[0].listaDeNumeros).toBe("1, 2, 3");
    // O parágrafo é o MESMO texto da recusa do servidor — duas redações do mesmo bloqueio é como a
    // tela passa a discordar de si mesma.
    expect(grupos[0].texto).toBe(explicarRecusa("sem_valor_previsto"));
  });

  // ⚠ CONTRATOS DIFERENTES NÃO SE MISTURAM: a ação em lote reescreve o CONTRATO, e aplicar um valor
  // a prestações de dois acordos num clique seria reescrever dois contratos de uma vez.
  it("mesmo motivo em contratos diferentes vira DOIS grupos", () => {
    const grupos = agruparBloqueiosDaFila([
      linhaDaFila({ parcelaId: "a1", parcelamentoId: "c1", parcelamento: { label: "A" } }),
      linhaDaFila({ parcelaId: "b1", parcelamentoId: "c2", parcelamento: { label: "B" } }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.parcelamentoId)).toEqual(["c1", "c2"]);
  });

  // ⚠ O GRUPO COM SAÍDA VEM PRIMEIRO. Enterrar a ação embaixo do bloqueio que não se resolve aqui é
  // mandar o contador ler primeiro o que ele não pode fazer.
  it("o grupo que se resolve NESTA tela vem antes do que se resolve em outra", () => {
    const grupos = agruparBloqueiosDaFila([
      linhaDaFila({ parcelaId: "x", motivoBloqueio: "provisao_inexistente" }),
      linhaDaFila({ parcelaId: "y", parcelamentoId: "c9", motivoBloqueio: "sem_valor_previsto" }),
    ]);
    expect(grupos[0].motivo).toBe("sem_valor_previsto");
    expect(grupos[0].corrigivelNaTela).toBe(true);
    expect(grupos[1].corrigivelNaTela).toBe(false);
  });

  it("linha sem bloqueio não entra em grupo nenhum", () => {
    expect(agruparBloqueiosDaFila([linhaDaFila({ podeBaixar: true, motivoBloqueio: null })])).toEqual([]);
    expect(agruparBloqueiosDaFila(null)).toEqual([]);
  });

  // ⚠ O RÓTULO CURTO É O QUE CABE NA LINHA — ele ANCORA o motivo, não o substitui.
  it("o rótulo curto existe para todo motivo, e nunca é o código cru", () => {
    expect(rotuloDoBloqueio("sem_valor_previsto")).toBe("Sem valor");
    expect(rotuloDoBloqueio("provisao_inexistente")).toBe("Sem provisão");
    expect(rotuloDoBloqueio("motivo_que_ninguem_previu")).toBe("Bloqueada");
    expect(rotuloDoBloqueio(null)).toBeNull();
  });

  // ⚠ SEM O NOME DO CONTRATO O TÍTULO MENTE POR OMISSÃO: com dois acordos na fila, "3 prestações
  // estão sem valor" faz a ação em lote parecer valer para a fila inteira.
  it("o título do grupo nomeia a contagem E o contrato", () => {
    const [g] = agruparBloqueiosDaFila([
      linhaDaFila({ parcelaId: "p1", numeroParcela: 1 }),
      linhaDaFila({ parcelaId: "p2", numeroParcela: 2 }),
      linhaDaFila({ parcelaId: "p3", numeroParcela: 3 }),
    ]);
    expect(tituloDoGrupo(g)).toBe("3 prestações do contrato PARCSN 2026 estão sem valor");
  });

  it("uma prestação só não vira plural", () => {
    const [g] = agruparBloqueiosDaFila([linhaDaFila()]);
    expect(tituloDoGrupo(g)).toBe("1 prestação do contrato PARCSN 2026 está sem valor");
  });
});

describe("planoDoLoteDeValor — o lote é um DADO, linha a linha", () => {
  const tres = [
    { parcelaId: "p1", numeroParcela: 1, competencia: "2026-05", valorPrevisto: 0 },
    { parcelaId: "p2", numeroParcela: 2, competencia: "2026-06", valorPrevisto: 0 },
    { parcelaId: "p3", numeroParcela: 3, competencia: "2026-07", valorPrevisto: 0 },
  ];

  it("um valor vale para todas, e cada linha diz de onde veio o número", () => {
    const plano = planoDoLoteDeValor({ parcelas: tres, textoPadrao: "1.200,00" });
    expect(plano.ok).toBe(true);
    expect(plano.validas).toHaveLength(3);
    expect(plano.linhas.every((l) => l.valor === 1200 && l.origem === "padrao")).toBe(true);
    expect(plano.total).toBe(3600);
  });

  // ⚠ A EDIÇÃO INDIVIDUAL É O PEDIDO DO DONO, e um lote que só aceitasse um número obrigaria a
  // desfazer no detalhe o que ele acabou de fazer no atacado (entrada maior, última quebrada).
  it("a linha editada vence o valor de todas", () => {
    const plano = planoDoLoteDeValor({
      parcelas: tres, textoPadrao: "1.200,00", overrides: { p2: "900,50" },
    });
    expect(plano.linhas.map((l) => l.valor)).toEqual([1200, 900.5, 1200]);
    expect(plano.linhas[1].origem).toBe("individual");
  });

  // ⚠ UMA LINHA ILEGÍVEL NÃO DERRUBA O LOTE, E NÃO SOBE EM SILÊNCIO: ela sai NOMEADA.
  it("linha ilegível fica de fora, com o motivo, e as outras seguem", () => {
    const plano = planoDoLoteDeValor({
      parcelas: tres, textoPadrao: "1.200,00", overrides: { p3: "1.23.4" },
    });
    expect(plano.validas.map((l) => l.parcelaId)).toEqual(["p1", "p2"]);
    expect(plano.invalidas).toHaveLength(1);
    expect(plano.invalidas[0].erro).toBeTruthy();
    expect(plano.ok).toBe(true);
  });

  // ⚠ DESABILITADO SEMPRE COM O MOTIVO — campo vazio é o caso mais comum e o mais difícil de
  // adivinhar olhando a lista.
  it("sem valor nenhum, o lote não é enviável e DIZ por quê", () => {
    const plano = planoDoLoteDeValor({ parcelas: tres, textoPadrao: "" });
    expect(plano.ok).toBe(false);
    expect(plano.mensagem).toMatch(/valor contratado/i);
  });

  it("valor zero ou negativo é recusado — prestação que vale zero não existe", () => {
    expect(planoDoLoteDeValor({ parcelas: tres, textoPadrao: "0" }).ok).toBe(false);
    expect(planoDoLoteDeValor({ parcelas: tres, textoPadrao: "-5" }).ok).toBe(false);
  });

  // ⚠ `0` E AUSENTE SÃO COISAS DIFERENTES, e continuam diferentes: a rota confere o "era", e trocar
  // um pelo outro faria o servidor recusar — ou, pior, aceitar sobre um "antes" que ninguém viu.
  it("o valor anterior viaja como está — zero não vira null", () => {
    const plano = planoDoLoteDeValor({
      parcelas: [
        { parcelaId: "p1", numeroParcela: 1, valorPrevisto: 0 },
        { parcelaId: "p2", numeroParcela: 2, valorPrevisto: null },
      ],
      textoPadrao: "100",
    });
    expect(plano.linhas[0].valorAnterior).toBe(0);
    expect(plano.linhas[1].valorAnterior).toBeNull();
  });
});

describe("a confirmação do lote REPETE prestação por prestação", () => {
  it("diz o que era e o que passa a ser, e que NÃO lança baixa", () => {
    const plano = planoDoLoteDeValor({
      parcelas: [
        { parcelaId: "p1", numeroParcela: 1, competencia: "2026-05", valorPrevisto: 0 },
        { parcelaId: "p2", numeroParcela: 2, competencia: "2026-06", valorPrevisto: 500 },
      ],
      textoPadrao: "1.200,00",
    });
    const texto = textoDaConfirmacaoDoLote(plano, "PARCSN 2026");
    expect(texto).toMatch(/ALTERA O CONTRATO/);
    expect(texto).toMatch(/prestação 1 \(competência 2026-05\): sem valor →/);
    // `\s` e não " ": `toLocaleString` pt-BR separa "R$" do número com espaço NÃO-QUEBRÁVEL.
    expect(texto).toMatch(/prestação 2 \(competência 2026-06\): R\$\s500,00 →/);
    // ⚠ O que ele NÃO faz é tão importante quanto o que faz: lote de valor não é lote de baixa.
    expect(texto).toMatch(/A baixa NÃO é lançada aqui/);
  });

  it("as que ficaram de fora são NOMEADAS na confirmação", () => {
    const plano = planoDoLoteDeValor({
      parcelas: [
        { parcelaId: "p1", numeroParcela: 1, valorPrevisto: 0 },
        { parcelaId: "p2", numeroParcela: 2, valorPrevisto: 0 },
      ],
      textoPadrao: "1.200,00",
      overrides: { p2: "abc" },
    });
    expect(textoDaConfirmacaoDoLote(plano, "PARCSN 2026")).toMatch(/Ficam de fora \(valor ilegível\): 2/);
  });
});
