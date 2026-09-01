// ⚠⚠ O MOCK ESCONDIA TRÊS RAMOS DA GUIA — sétima vez nesta base (31/08/2026).
//
// Toda guia do mock nascia com `extracted: null`, `parcelamentoId: null` e um dos dois tipos
// (`SIMPLES`/`INSS`). Consequência: o rótulo da **DARF consolidada do Lucro Presumido** — o
// conserto do MESMO dia, que faz a guia se chamar "PIS · COFINS" em vez de "OUTRA" — era
// **inalcançável offline**, e o mesmo valia para a precedência da PARCELA sobre o tipo.
//
// ⚠ A lição já está escrita neste projeto: *"o mock usava só valores redondos (…), então dois
// ramos inteiros nunca eram alcançáveis offline"*. Um ramo que só existe em produção é um ramo que
// ninguém vê antes de o cliente ver.

import { createMockApi } from "../mock/mockApi";
import { definirTokens, limparSessao } from "../sessionStore";

// ⚠ O mesmo arranjo de `saidasDoClienteNoMock.test.js`: instância NOVA por caso, sessão de
// verdade — `getGuides` passa por `exigirAcessoEmpresa`, como no servidor.
let api;

beforeEach(async () => {
  window.localStorage.clear();
  limparSessao();
  api = createMockApi();
  const sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
});

async function guiasDe(companyId) {
  // ⚠ `limit` alto e sem competência: o que se mede é a EXISTÊNCIA do ramo na base do mock, e um
  // recorte de página o esconderia exatamente como o mock o escondia antes.
  // ⚠ A rota devolve `{ data, page, limit, total }` — `data`, não `items`. Ler a chave errada
  // aqui devolveria lista vazia e o teste diria "o ramo não existe" sobre um mock correto.
  const r = await api.getGuides(companyId, { limit: 200 });
  return r?.data || [];
}

describe("⚠⚠ os três ramos da guia são alcançáveis OFFLINE", () => {
  it("⚠⚠ a DARF do Presumido tem COMPOSIÇÃO — é o que faz a guia se chamar `PIS · COFINS`", async () => {
    const guias = await guiasDe("pc-005");
    const comComposicao = guias.filter(
      (g) => g.tipo === "OUTRA" && Array.isArray(g.extracted?.composicao) && g.extracted.composicao.length
    );
    expect(comComposicao.length).toBeGreaterThan(0);
    // ⚠ A forma medida em produção: `tributo` já preenchido (24 dos 29 itens da base).
    const tributos = comComposicao[0].extracted.composicao.map((c) => c.tributo);
    expect(tributos).toEqual(expect.arrayContaining(["PIS", "COFINS"]));
    // ⚠ E a denominação inteira viaja: é dela que sai o detalhamento por tributo no `title`.
    expect(comComposicao[0].extracted.composicao[0].denominacao).toMatch(/PIS/);
  });

  it("⚠⚠ e o CONTRAPONTO existe: `OUTRA` SEM composição, que continua se chamando `OUTRA`", async () => {
    // Medido: 7 das 20 guias `OUTRA` da base estão assim. Sem esta linha, "OUTRA" pareceria um
    // estado que não existe mais — e inventar "PIS · COFINS" numa guia sem composição afirmaria ao
    // cliente quais impostos ele paga, sem ninguém ter medido.
    const guias = await guiasDe("pc-005");
    const semComposicao = guias.filter((g) => g.tipo === "OUTRA" && !g.extracted?.composicao);
    expect(semComposicao.length).toBeGreaterThan(0);
  });

  it("⚠⚠ a PARCELA existe, e ela é gravada IDÊNTICA ao DAS — só o `parcelamentoId` as separa", async () => {
    const guias = await guiasDe("pc-001");
    const parcela = guias.find((g) => g.parcelamentoId);
    expect(parcela).toBeTruthy();
    // ⚠ É esta igualdade que torna a precedência do rótulo necessária: sem decidir pelo
    // parcelamento ANTES do tipo, a parcela apareceria como o DAS do mês — dívida antiga se
    // passando pelo imposto corrente.
    expect(parcela.tipo).toBe("SIMPLES");
    expect(parcela.parcelamentoLabel).toMatch(/Parcela \d+ de parcelamento/);
    expect(parcela.numeroParcela).toBeGreaterThan(0);
  });

  it("⚠ e continua havendo guia SEM parcelamento — senão o ramo comum é que sumiria", async () => {
    const guias = await guiasDe("pc-001");
    expect(guias.some((g) => !g.parcelamentoId && g.tipo === "SIMPLES")).toBe(true);
  });
});
