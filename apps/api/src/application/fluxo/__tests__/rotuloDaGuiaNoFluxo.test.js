// ⚠⚠ A GUIA DO PRESUMIDO APARECIA COMO "OUTRA" NO PAINEL E NO FLUXO (31/08/2026)
//
// > Dono: *"as guias de presumido, no caso da sincrosat, aparece como outras"* → *"elas aparecem
// > outras apenas no cliente, mas no contador está PIS e COFINS bem denominado."*
//
// ⚠⚠ **HAVIA DOIS RÓTULOS, E SÓ UM SABIA LER A COMPOSIÇÃO.** A **aba Guias** do cliente usa
// `features/guias/lib/rotuloGuia.js`, que lê `extracted.composicao` e escreve "PIS · COFINS" —
// conserto de 24/08/2026, amarrado por teste ao rótulo do contador. Já o **painel**
// (`GuiasVencidas`) e o **fluxo de caixa** recebem o rótulo PRONTO do servidor, e o de cá devolvia
// o `tipo` cru. Mesma empresa, mesma guia, dois nomes — dependendo da tela.
//
// ⚠ E a composição nem chegava aqui: `extracted` estava **fora do `select`** da consulta de guias
// do fluxo. Coluna fora de um `select` explícito volta `undefined`, e quem a lê não erra — só não
// encontra nada. É a armadilha que este projeto já pagou com `codigosServicoNacional`, com a carga
// tributária e com o `codigoMunicipioIbge`.
//
// ⚠⚠ O AMARRE COM O ESPELHO DO CLIENTE É O TESTE PRINCIPAL: sem ele, "mesma regra" é intenção e
// não fato, e a divergência voltaria como o contador vendo "PIS · COFINS" e o cliente vendo outra
// coisa sobre a MESMA guia.

import { rotuloDaGuia as rotuloDoCliente } from "../../../../../portal-cliente-web/src/features/guias/lib/rotuloGuia.js";
import { montarFluxoDeCaixa } from "../FluxoDeCaixaService.js";

// A composição REAL da guia da SINCROSAT, medida em produção em 31/08/2026.
const COMPOSICAO_SPO = Object.freeze([
  { denominacao: "PIS - FATURAMENTO - PJ EM GERAL", total: 431.25 },
  { denominacao: "COFINS - FATURAMENTO/PJ EM GERAL", total: 1004.24 },
]);

// ⚠ O rótulo do servidor não é exportado (é detalhe do módulo). O que se mede é o RESULTADO: a
// linha do fluxo. Testar a função por dentro deixaria passar o `select` sem `extracted`, que é
// metade do defeito.
function guia(extra = {}) {
  return {
    id: "g-1",
    tipo: "OUTRA",
    competencia: "2026-07",
    valor: 1435.49,
    vencimento: new Date(Date.UTC(2026, 7, 20)),
    paymentStatus: "OPEN",
    numeroParcela: null,
    parcelamentoId: null,
    paymentConfirmedAt: null,
    extracted: { composicao: COMPOSICAO_SPO },
    ...extra,
  };
}

/**
 * ⚠ Proxy que materializa QUALQUER model sob demanda, vazio — o mesmo molde das suítes de rota.
 *
 * Listar os delegates à mão faz o teste quebrar com `undefined.findMany` toda vez que o fluxo
 * passar a ler uma tabela nova, e o vermelho não fala do que está sendo medido aqui: o RÓTULO.
 */
function clienteFalso(guias) {
  const vazio = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    aggregate: async () => ({}),
    groupBy: async () => [],
  };
  return new Proxy(
    {
      guide: { ...vazio, findMany: async () => guias },
      portalClient: { ...vazio, findUnique: async () => ({ id: "pc-1", companyId: "c-1" }) },
    },
    { get: (alvo, prop) => (typeof prop === "symbol" ? alvo[prop] : alvo[prop] || vazio) }
  );
}

async function rotulosDoFluxo(guias) {
  const r = await montarFluxoDeCaixa({
    portalClientId: "pc-1",
    competencia: "2026-07",
    client: clienteFalso(guias),
  });
  return (r.meses || [])
    .flatMap((m) => m.linhas || [])
    .filter((l) => l?.referencia?.tipo === "guia")
    .map((l) => l.rotulo);
}

describe("⚠⚠ a DARF do Presumido se chama pelos tributos que ela contém", () => {
  it("a guia da SINCROSAT sai como `PIS · COFINS`, não como `OUTRA`", async () => {
    const rotulos = await rotulosDoFluxo([guia()]);
    expect(rotulos).not.toBeNull();
    expect(rotulos).toContain("PIS · COFINS");
    expect(rotulos).not.toContain("OUTRA");
  });

  it("⚠⚠ e ela concorda com o rótulo da ABA GUIAS — o amarre com o espelho do cliente", async () => {
    // Se as duas divergirem, a mesma guia tem dois nomes em duas telas do MESMO portal.
    const doCliente = rotuloDoCliente({ tipo: "OUTRA", extracted: { composicao: COMPOSICAO_SPO } });
    const [doFluxo] = await rotulosDoFluxo([guia()]);
    expect(doFluxo).toBe(doCliente);
  });

  it("⚠⚠ SEM composição continua `OUTRA` — é o que está GRAVADO", async () => {
    // Medido: 7 das 20 guias `OUTRA` da base não têm composição. Inventar "PIS · COFINS" nelas
    // afirmaria ao cliente quais impostos ele paga, sem ninguém ter medido.
    for (const extracted of [null, {}, { composicao: [] }, { composicao: "nao-e-lista" }]) {
      const [r] = await rotulosDoFluxo([guia({ extracted })]);
      expect(r).toBe("OUTRA");
    }
  });

  it("⚠ tributo repetido não repete no rótulo", async () => {
    const comp = [
      { denominacao: "PIS - FATURAMENTO - PJ EM GERAL" },
      { denominacao: "PIS - OUTRA COISA" },
      { denominacao: "COFINS - FATURAMENTO/PJ EM GERAL" },
    ];
    const [r] = await rotulosDoFluxo([guia({ extracted: { composicao: comp } })]);
    expect(r).toBe("PIS · COFINS");
  });

  it("⚠ os outros tipos NÃO passam pela composição — `SIMPLES` continua `SIMPLES`", async () => {
    // A regra é só da DARF consolidada. Um `INSS` com composição por engano não pode mudar de nome.
    const [r] = await rotulosDoFluxo([guia({ tipo: "SIMPLES" })]);
    expect(r).toBe("SIMPLES");
  });

  it("⚠⚠ PARCELAMENTO decide ANTES do tipo — a parcela não vira o nome dos tributos", async () => {
    // A parcela é gravada com o tipo do imposto; invertida a ordem, ela apareceria como a guia do mês.
    const [r] = await rotulosDoFluxo([guia({ parcelamentoId: "p-1", numeroParcela: 7 })]);
    expect(r).toBe("Parcela 7 de parcelamento");
  });
});
