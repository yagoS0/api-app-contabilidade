// ⚠⚠ A NOTA SUBSTITUÍDA LIA "CANCELADA" NESTA TELA — e "Substituída" na do contador.
//
// Mesmo documento fiscal, dois fatos, dois portais. O `status` só distingue as duas quando o ADN
// mandou o evento; sem ele a nota substituída fica `CANCELADA`, e isso é o caso COMUM (556 NFS-e
// canceladas com ZERO eventos guardados, medido em produção). Quem sabia mais era o `derivarCiclo`
// do backend, por uma terceira evidência — outra nota na base declarando substituir esta.
//
// ⚠ Estes casos travam a PRECEDÊNCIA, que é estreita de propósito: o `ciclo` vence numa coisa só.

import { CHIP_POR_STATUS, chipDaNota } from "../chipDaNota";

const comCiclo = (status, situacao) => ({ status, ciclo: { situacao } });

describe("o de-para do `status`, que é o que sempre existiu", () => {
  it.each([
    ["EMITIDA", "emitida", "Emitida"],
    ["CANCELADA", "cancelada", "Cancelada"],
    ["SUBSTITUIDA", "substituida", "Substituída"],
    ["REJEITADA", "rejeitada", "Rejeitada"],
    ["PENDENTE", "processando", "Pendente"],
  ])("%s → data-status=%s", (status, dataStatus, rotulo) => {
    expect(chipDaNota({ status })).toEqual({ status: dataStatus, rotulo });
  });

  it("⚠ valor fora da lista sai SEM cor — e é assim que a falha aparece", () => {
    // Chip sem `data-status` não recebe superfície nenhuma no CSS: ele fica visivelmente diferente
    // dos outros, em vez de pegar a cor de um vizinho e mentir em silêncio.
    expect(chipDaNota({ status: "INVENTADO" })).toEqual({ status: null, rotulo: "INVENTADO" });
  });

  it("sem status nenhum, um traço — nunca a palavra vazia", () => {
    expect(chipDaNota({}).status).toBeNull();
    expect(chipDaNota({}).rotulo).toBe("—");
  });
});

describe("⚠⚠ o `ciclo` vence em UMA coisa: dizer `substituida`", () => {
  it("nota marcada CANCELADA cujo ciclo diz substituída sai SUBSTITUÍDA — o defeito", () => {
    expect(chipDaNota(comCiclo("CANCELADA", "substituida"))).toEqual(CHIP_POR_STATUS.SUBSTITUIDA);
  });

  it("e o `data-status` é o mesmo que a nota substituída sempre teve", () => {
    // Sem isto o conserto criaria um SEXTO valor de `data-status` — e valor fora da lista renderiza
    // sem cor, que é exatamente o defeito que este chip já nomeia.
    expect(chipDaNota(comCiclo("CANCELADA", "substituida")).status).toBe("substituida");
  });
});

describe("⚠⚠ e ele NÃO vence no resto — cada exclusão custaria caro", () => {
  it("⚠ `autorizada` NÃO apaga REJEITADA — seria o pior desfecho desta lista", () => {
    // `derivarCiclo` chama de `autorizada` tudo que não está cancelado, inclusive a nota que a
    // Receita RECUSOU. Mostrada como "Emitida", quem emitiu concluiria que tem nota fiscal onde não
    // tem — e só descobriria na apuração.
    expect(chipDaNota(comCiclo("REJEITADA", "autorizada"))).toEqual(CHIP_POR_STATUS.REJEITADA);
  });

  it("⚠ `autorizada` NÃO apaga PENDENTE", () => {
    expect(chipDaNota(comCiclo("PENDENTE", "autorizada"))).toEqual(CHIP_POR_STATUS.PENDENTE);
  });

  it("⚠ `cancelada` do ciclo NÃO rebaixa um `status` SUBSTITUIDA", () => {
    // Aqui o `status` é o mais específico dos dois: ele só diz SUBSTITUIDA quando o ADN mandou o
    // evento. Rebaixá-lo desfaria justamente o caso em que a captura funcionou.
    expect(chipDaNota(comCiclo("SUBSTITUIDA", "cancelada"))).toEqual(CHIP_POR_STATUS.SUBSTITUIDA);
  });

  it("`autorizada` sobre EMITIDA não muda nada — os dois já concordam", () => {
    expect(chipDaNota(comCiclo("EMITIDA", "autorizada"))).toEqual(CHIP_POR_STATUS.EMITIDA);
  });
});

describe("⚠ AUSENTE NÃO É NADA — sem `ciclo`, o comportamento é o de antes", () => {
  // Nota nossa recém-emitida (`ciclo: null` por contrato), backend antigo, ou a coluna fora de um
  // `select`: o modo de falhar tem de ser "como era", nunca "afirma outra coisa".
  it.each([
    ["ciclo ausente", { status: "CANCELADA" }],
    ["ciclo null", { status: "CANCELADA", ciclo: null }],
    ["situacao ausente", { status: "CANCELADA", ciclo: {} }],
    ["situacao null", { status: "CANCELADA", ciclo: { situacao: null } }],
  ])("%s → Cancelada, como antes", (_, nota) => {
    expect(chipDaNota(nota)).toEqual(CHIP_POR_STATUS.CANCELADA);
  });

  it("⚠ e a string crua continua servindo — é o caminho SEM ciclo", () => {
    // A função nasceu recebendo `nota.status` direto; aceitar a string evita que copiar a linha
    // para outra tela produza um `[object Object]` silencioso.
    expect(chipDaNota("EMITIDA")).toEqual(CHIP_POR_STATUS.EMITIDA);
    expect(chipDaNota(null).status).toBeNull();
  });

  it("a situação vem em qualquer caixa — o backend manda minúscula, mas não se depende disso", () => {
    expect(chipDaNota({ status: "CANCELADA", ciclo: { situacao: "SUBSTITUIDA" } }))
      .toEqual(CHIP_POR_STATUS.SUBSTITUIDA);
  });
});

describe("⚠ o mapa é CONGELADO — ninguém acrescenta um sexto valor por engano", () => {
  it("`Object.freeze` de verdade", () => {
    expect(Object.isFrozen(CHIP_POR_STATUS)).toBe(true);
  });

  it("os cinco `data-status` são os que o CSS conhece", () => {
    // ⚠ A lista é lida do CSS por `guias/__tests__/chipDaGuiaTemCor.test.js` (o mesmo arranjo); aqui
    // o que se trava é que estes cinco nomes não mudem sozinhos — eles são o vocabulário que o app
    // mobile espelha.
    expect(Object.values(CHIP_POR_STATUS).map((c) => c.status).sort())
      .toEqual(["cancelada", "emitida", "processando", "rejeitada", "substituida"]);
  });
});
