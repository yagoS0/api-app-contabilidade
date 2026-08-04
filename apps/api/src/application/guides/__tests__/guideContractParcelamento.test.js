// A regra "esta guia é uma parcela?" vive em UM lugar porque DUAS telas dependem dela: o compliance
// do dashboard (chip da listagem) e o `batch-report` (matriz do envio em lote). Quando cada uma
// tinha a sua leitura, as duas mostravam a mesma guia de jeitos diferentes — e as duas erradas.

import { isGuiaDeParcelamento, colunaMatrizDaGuia } from "../guideContract.js";

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
