// O ESPELHO DO RÓTULO DA GUIA — e o amarre com o portal do CONTADOR.
//
// ⚠⚠ O TESTE PRINCIPAL É O AMARRE. Ele importa `rotuloTipoGuia` de `apps/web` e exige que as duas
// implementações digam a MESMA coisa sobre a MESMA guia. Sem ele, "espelho" é intenção e não fato:
// a divergência apareceria em produção como o contador vendo "PIS · COFINS" e o cliente vendo
// "OUTRA" sobre a mesma DARF — que é literalmente o defeito que este módulo desfez (24/08/2026).
//
// Mesmo caminho do precedente `features/emitir/lib/__tests__/codigoServicoDaNota.test.js`, que
// importa a autoridade do backend em vez de copiá-la.
import { rotuloTipoGuia } from "../../../../../../web/src/features/guides/lib/rotuloGuia.js";
import { detalheDaGuia, rotuloDaGuia } from "../rotuloGuia.js";

const comp = (...tributos) => ({ extracted: { composicao: tributos.map((t) => ({ tributo: t })) } });

describe("o rótulo da guia no portal do cliente", () => {
  it("a DARF consolidada do LP mostra os TRIBUTOS, não a palavra OUTRA", () => {
    // O caso real medido em produção (KODA BEAR, SINCROSAT, EDUCACAO E DIREITO — 2026-07).
    expect(rotuloDaGuia({ tipo: "OUTRA", ...comp("PIS", "COFINS") })).toBe("PIS · COFINS");
  });

  it("o mês com os quatro tributos sai inteiro", () => {
    // EDUCACAO E DIREITO / KODA BEAR, 2026-06.
    expect(rotuloDaGuia({ tipo: "OUTRA", ...comp("IRPJ", "CSLL", "PIS", "COFINS") }))
      .toBe("IRPJ · CSLL · PIS · COFINS");
  });

  it("tributo repetido aparece UMA vez", () => {
    expect(rotuloDaGuia({ tipo: "OUTRA", ...comp("PIS", "PIS", "COFINS") })).toBe("PIS · COFINS");
  });

  it("a denominação longa vira o nome curto", () => {
    const g = { tipo: "OUTRA", extracted: { composicao: [{ denominacao: "IRRF - ALUGUEIS E ROYALTIES" }] } };
    expect(rotuloDaGuia(g)).toBe("IRRF");
  });

  it("⚠ SEM composição o rótulo continua OUTRA — não se inventa qual imposto é", () => {
    expect(rotuloDaGuia({ tipo: "OUTRA" })).toBe("OUTRA");
    expect(rotuloDaGuia({ tipo: "OUTRA", extracted: { composicao: [] } })).toBe("OUTRA");
    expect(rotuloDaGuia({ tipo: "OUTRA", extracted: { composicao: "nao-e-array" } })).toBe("OUTRA");
  });

  it("os outros tipos não são tocados", () => {
    expect(rotuloDaGuia({ tipo: "SIMPLES" })).toBe("SIMPLES");
    expect(rotuloDaGuia({ tipo: "INSS", ...comp("PIS") })).toBe("INSS");
    expect(rotuloDaGuia({})).toBe("-");
  });

  it("⚠ o PARCELAMENTO decide ANTES do tipo — senão a parcela apareceria como a DARF", () => {
    const g = { tipo: "OUTRA", parcelamentoLabel: "PARC SN Nº 1 · 3/10", ...comp("PIS", "COFINS") };
    expect(rotuloDaGuia(g)).toBe("PARC SN Nº 1 · 3/10");
    expect(detalheDaGuia(g)).toBeUndefined();
  });
});

describe("o detalhamento por tributo (o `title` da célula)", () => {
  it("lista cada imposto com o valor", () => {
    const g = {
      tipo: "OUTRA",
      extracted: { composicao: [{ tributo: "PIS", total: 123.4 }, { tributo: "COFINS", total: 568.9 }] },
    };
    const t = detalheDaGuia(g);
    expect(t).toContain("PIS — R$ 123,40");
    expect(t).toContain("COFINS — R$ 568,90");
  });

  it("tributo sem valor sai sem número inventado", () => {
    expect(detalheDaGuia({ tipo: "OUTRA", ...comp("PIS") })).toBe("Impostos contidos nesta guia:\n• PIS");
  });

  it("não há detalhe onde não há composição", () => {
    expect(detalheDaGuia({ tipo: "OUTRA" })).toBeUndefined();
    expect(detalheDaGuia({ tipo: "SIMPLES", ...comp("PIS") })).toBeUndefined();
  });
});

describe("⚠⚠ O AMARRE — o cliente e o contador dizem o MESMO sobre a mesma guia", () => {
  // ⚠ Só guias SEM parcelamento entram: o ramo do parcelamento é deliberadamente diferente nos
  // dois apps (lá o rótulo é montado no front, aqui vem pronto do backend em `parcelamentoLabel`),
  // e isso está escrito no cabeçalho de `rotuloGuia.js`. O que se amarra é a regra da DARF.
  const CASOS = [
    { tipo: "OUTRA", ...comp("PIS", "COFINS") },
    { tipo: "OUTRA", ...comp("IRPJ", "CSLL", "PIS", "COFINS") },
    { tipo: "OUTRA", ...comp("IRPJ", "CSLL", "IRRF", "PIS", "COFINS") },
    { tipo: "OUTRA", ...comp("CP SEGURADOS") },
    { tipo: "OUTRA", ...comp("PIS", "PIS", "COFINS") },
    { tipo: "OUTRA", extracted: { composicao: [{ denominacao: "IRRF - ALUGUEIS E ROYALTIES" }] } },
    { tipo: "OUTRA", extracted: { composicao: [{ codigo: "8109" }] } },
    { tipo: "OUTRA", extracted: { composicao: [] } },
    { tipo: "OUTRA" },
    { tipo: "SIMPLES" },
    { tipo: "INSS", ...comp("PIS") },
    {},
  ];

  it.each(CASOS.map((g, i) => [i, g]))("caso %i tem o mesmo veredito nos dois portais", (_i, guia) => {
    expect(rotuloDaGuia(guia)).toBe(rotuloTipoGuia(guia));
  });
});
