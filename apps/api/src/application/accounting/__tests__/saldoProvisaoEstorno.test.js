// SALDO DA PROVISÃO COM CONTRA-LANÇAMENTO DE ESTORNO.
//
// ⚠ ESTE É O EFEITO COLATERAL QUE PASSARIA DESPERCEBIDO. O contra-lançamento do estorno em mês
// fechado carrega `openEntryId` — ele PRECISA carregar, é o que liga o espelho à provisão que ele
// devolve ao aberto. Mas `openEntryId` é também a relação `baixas`, que `computeSaldoProvisao`
// varre somando os DÉBITOS não-acréscimo de tudo que pendura ali.
//
// O espelho de uma baixa `D 553 / C caixa` é `D caixa / C 553`. Lido como baixa, o débito de CAIXA
// entraria na conta como MAIS uma amortização: a provisão sairia do estorno com o dobro do abatido
// em vez de com o saldo devolvido. E o erro seria silencioso — nenhuma exceção, só um passivo
// errado, na operação que existe justamente para corrigir um passivo errado.
//
// É a mesma razão pela qual o espelho não é `tipo:"BAIXA"`: lá o motivo é o índice único
// `uq_baixa_guia_linha`, aqui é a aritmética. As duas apontam para a mesma decisão.

import { computeSaldoProvisao } from "../saldoProvisao";

const provisao = (baixas) => ({
  lines: [{ conta: "553", tipo: "D", valor: 1000 }, { conta: "111", tipo: "C", valor: 1000 }],
  baixas,
});

const baixa = (valor, conta = "553") => ({
  tipo: "BAIXA",
  lines: [{ conta, tipo: "D", valor }, { conta: "111", tipo: "C", valor }],
});

// O espelho: mesmas contas, mesmos valores, lados invertidos.
const espelhoDe = (b) => ({
  tipo: "ESTORNO",
  lines: (b.lines || []).map((l) => ({ ...l, tipo: l.tipo === "D" ? "C" : "D" })),
});

describe("computeSaldoProvisao", () => {
  it("sem baixa, a provisão está inteira em aberto", () => {
    expect(computeSaldoProvisao(provisao([]))).toMatchObject({ principal: 1000, abatido: 0, saldo: 1000 });
  });

  it("baixa amortiza o principal (comportamento de sempre)", () => {
    expect(computeSaldoProvisao(provisao([baixa(400)]))).toMatchObject({ abatido: 400, saldo: 600, quotasPagas: 1 });
  });

  it("⚠ o ESPELHO SUBTRAI — a baixa continua na tabela e quem a anula é ele", () => {
    const b = baixa(400);
    // Mês fechado: a baixa NÃO foi apagada. As duas linhas convivem.
    const s = computeSaldoProvisao(provisao([b, espelhoDe(b)]));
    expect(s.abatido).toBe(0);
    expect(s.saldo).toBe(1000); // de volta ao aberto, exatamente como antes da baixa
  });

  it("⚠ lido como baixa, o espelho DOBRARIA o abatido — é o defeito que o `tipo` evita", () => {
    const b = baixa(400);
    const espelhoDisfarcado = { ...espelhoDe(b), tipo: "BAIXA" };
    const errado = computeSaldoProvisao(provisao([b, espelhoDisfarcado]));
    expect(errado.abatido).toBe(800); // 400 da baixa + 400 do débito de CAIXA do espelho
    expect(errado.saldo).toBe(200);   // a provisão iria para o lado errado, em dobro
  });

  it("estorno de uma quota só: as outras continuam valendo", () => {
    const b1 = baixa(400);
    const s = computeSaldoProvisao(provisao([b1, baixa(300), espelhoDe(b1)]));
    expect(s).toMatchObject({ abatido: 300, saldo: 700, quotasPagas: 1 });
  });

  it("⚠ a quota estornada deixa de contar — senão a próxima baixa nasceria numerada errado", () => {
    const b = baixa(400);
    expect(computeSaldoProvisao(provisao([b, espelhoDe(b)])).quotasPagas).toBe(0);
  });

  it("juros e multa não entram no principal — nem na baixa nem no espelho", () => {
    // 501 = juros, 506 = multa: despesa do mês do pagamento, nunca amortização do passivo.
    const juros = baixa(50, "501");
    const s = computeSaldoProvisao(provisao([baixa(400), juros]));
    expect(s.abatido).toBe(400);
    const comEstorno = computeSaldoProvisao(provisao([baixa(400), juros, espelhoDe(juros)]));
    expect(comEstorno.abatido).toBe(400); // estornar o juros não mexe no principal
  });

  it("o abatido nunca fica negativo", () => {
    const b = baixa(400);
    // Estorno duplicado (não deveria acontecer) não pode virar saldo maior que o principal.
    const s = computeSaldoProvisao(provisao([b, espelhoDe(b), espelhoDe(b)]));
    expect(s.abatido).toBe(0);
    expect(s.saldo).toBe(1000);
  });
});
