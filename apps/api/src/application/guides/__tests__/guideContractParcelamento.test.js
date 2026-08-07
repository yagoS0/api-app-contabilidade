// A regra "esta guia é uma parcela?" vive em UM lugar porque DUAS telas dependem dela: o compliance
// do dashboard (chip da listagem) e o `batch-report` (matriz do envio em lote). Quando cada uma
// tinha a sua leitura, as duas mostravam a mesma guia de jeitos diferentes — e as duas erradas.

import {
  isGuiaDeParcelamento,
  colunaMatrizDaGuia,
  WHERE_GUIA_DE_PARCELAMENTO,
  WHERE_GUIA_SEM_PARCELAMENTO,
  SELECT_PARCELAMENTO_DA_GUIA,
} from "../guideContract.js";

describe("isGuiaDeParcelamento", () => {
  it("o que decide é o parcelamentoId, não o tipo", () => {
    expect(isGuiaDeParcelamento({ tipo: "SIMPLES", parcelamentoId: "p1" })).toBe(true);
    expect(isGuiaDeParcelamento({ tipo: "SIMPLES", parcelamentoId: null })).toBe(false);
  });

  it("parcela de INSS parcelado também é parcela", () => {
    expect(isGuiaDeParcelamento({ tipo: "INSS", parcelamentoId: "p2" })).toBe(true);
  });

  it("guia ausente não quebra", () => {
    expect(isGuiaDeParcelamento(null)).toBe(false);
    expect(isGuiaDeParcelamento(undefined)).toBe(false);
  });
});

describe("colunaMatrizDaGuia", () => {
  it("SIMPLES sem parcelamento é a coluna DAS", () => {
    expect(colunaMatrizDaGuia({ tipo: "SIMPLES", parcelamentoId: null })).toBe("DAS");
  });

  it("SIMPLES COM parcelamento vai para PARC_DAS — este era o bug", () => {
    expect(colunaMatrizDaGuia({ tipo: "SIMPLES", parcelamentoId: "p1" })).toBe("PARC_DAS");
  });

  it("a checagem de parcela vem ANTES da tradução SIMPLES→DAS", () => {
    // Se a ordem invertesse, a parcela cairia em DAS e nunca chegaria em PARC_DAS.
    expect(colunaMatrizDaGuia({ tipo: "INSS", parcelamentoId: "p1" })).toBe("PARC_DAS");
  });

  it("os demais tipos passam direto", () => {
    expect(colunaMatrizDaGuia({ tipo: "INSS" })).toBe("INSS");
    expect(colunaMatrizDaGuia({ tipo: "darf" })).toBe("DARF");
  });
});

describe("filtros Prisma", () => {
  it("os dois lados concordam com isGuiaDeParcelamento", () => {
    // O `where` e o predicado precisam responder a MESMA pergunta: é a divergência entre eles que
    // faz uma tela contar a parcela como DAS e a outra não.
    expect(WHERE_GUIA_DE_PARCELAMENTO).toEqual({ parcelamentoId: { not: null } });
    expect(WHERE_GUIA_SEM_PARCELAMENTO).toEqual({ parcelamentoId: null });
  });

  it("o select do parcelamento traz o que a tela precisa para NOMEAR a guia", () => {
    // Sem modalidade e número, a UI sabe que é parcela mas não de qual acordo — e cai no `tipo`,
    // que é "SIMPLES" e nomeia o DAS do mês.
    expect(SELECT_PARCELAMENTO_DA_GUIA.tipo).toBe(true);
    expect(SELECT_PARCELAMENTO_DA_GUIA.numeroParcelamento).toBe(true);
    expect(SELECT_PARCELAMENTO_DA_GUIA.label).toBe(true);
  });
});
