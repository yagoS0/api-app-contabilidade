// A PARCELA de parcelamento não é o DAS do mês.
//
// Este é o bug que o dono viu na ERISANGELA: a parcela é gravada com `tipo:"SIMPLES"`, igual ao DAS
// (`CaptureSerproParcelaService`), e o que as separa é o `parcelamentoId`. Sem esse filtro, a
// parcela satisfazia o nó `das` e a empresa aparecia "com DAS gerada" sem nunca ter gerado o DAS.
//
// ⚠ Diferente do `guideComplianceCiclo.test.js`, este teste importa o código de VERDADE (com prisma
// mockado) em vez de replicar a função. É de propósito: a regra que ele protege é justamente a que
// mora na query, e uma réplica não veria a query mudar.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    accountingEntry: { findMany: jest.fn() },
    companyMonthlyCircular: { findMany: jest.fn() },
    guide: { findMany: jest.fn() },
    // O estado de envio deixou de sair de `emailStatus`: vem de `envios_guia`, um registro por
    // canal. O default vazio significa "gerada, ainda nao enviada" -- que e o caso da maioria dos
    // testes aqui.
    envioGuia: { findMany: jest.fn(async () => []) },
  },
}));

jest.mock("../../notas/apuracao/v2/FechamentoService.js", () => ({
  faturamentoEmitPorEmpresa: jest.fn(async () => new Map()),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { computeGuideComplianceMap } from "../guideCompliance.js";

const COMP = "2026-05";
const PORTAL = "pc-erisangela";
const linhaSimples = { portalId: PORTAL, hasProlabore: false, legacy: { regimeTributario: "SIMPLES" } };

/**
 * O `guide.findMany` é chamado DUAS vezes com propósitos opostos: a pré-query pega só as parcelas
 * (`parcelamentoId: { not: null }`) e a principal pega só o resto (`parcelamentoId: null`). Este
 * despachante separa as duas pelo próprio filtro — se alguém trocar o sentido do filtro, o teste
 * quebra, que é o ponto.
 */
function mockGuides({ parcelas = [], normais = [] } = {}) {
  prisma.guide.findMany.mockImplementation(async ({ where }) => (
    where?.parcelamentoId === null ? normais : parcelas
  ));
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.accountingEntry.findMany.mockResolvedValue([]);
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);
  // Sem envio registrado = guia gerada e ainda não enviada, que é o estado da maioria dos casos
  // testados aqui. Quem quiser "enviada" registra o envio explicitamente.
  prisma.envioGuia.findMany.mockResolvedValue([]);
  mockGuides();
});

describe("parcela de parcelamento × DAS", () => {
  it("guia de parcelamento NÃO satisfaz o DAS — e o DAS continua faltando", async () => {
    mockGuides({
      parcelas: [{
        portalClientId: PORTAL, id: "g-parc", emailStatus: "PENDING", emailSentAt: null,
        numeroParcela: 3, quantidadeParcelas: 60,
        parcelamento: { tipo: "PARCSN", numeroParcelamento: "123" },
      }],
      normais: [],
    });

    const map = await computeGuideComplianceMap([linhaSimples], COMP);
    const c = map.get(PORTAL);

    expect(c.das.state).toBe("missing");
    expect(c.das.ok).toBe(false);
    expect(c.parcDas.required).toBe(true);
    expect(c.parcDas.state).toBe("gerada");
    expect(c.parcDas.guideId).toBe("g-parc");
    // O agregado enxerga a pendência do DAS.
    expect(c.ok).toBe(false);
  });

  it("o contexto do acordo vai junto — senão o chip não sabe QUAL parcelamento é", async () => {
    mockGuides({
      parcelas: [{
        portalClientId: PORTAL, id: "g-parc", emailStatus: "SENT", emailSentAt: new Date("2026-06-01"),
        numeroParcela: 3, quantidadeParcelas: 60,
        parcelamento: { tipo: "PARCSN", numeroParcelamento: "123" },
      }],
    });
    // ⚠ "Enviada" vem dos ENVIOS, não de `emailStatus` — o campo continua no payload como detalhe
    // de transporte, mas quem decide o estado é `envios_guia`.
    prisma.envioGuia.findMany.mockResolvedValue([
      { guideId: "g-parc", canal: "EMAIL", status: "entregue", entregueEm: new Date("2026-06-01") },
    ]);

    const { parcDas } = map(await computeGuideComplianceMap([linhaSimples], COMP));
    expect(parcDas.state).toBe("enviada");
    expect(parcDas.canalEnvio).toBe("EMAIL");
    expect(parcDas.tipoParcelamento).toBe("PARCSN");
    expect(parcDas.numeroParcelamento).toBe("123");
    expect(parcDas.numeroParcela).toBe(3);
    expect(parcDas.quantidadeParcelas).toBe(60);
  });

  it("DAS de verdade e parcela convivem: cada um no seu nó", async () => {
    mockGuides({
      parcelas: [{
        portalClientId: PORTAL, id: "g-parc", emailStatus: "PENDING", emailSentAt: null,
        numeroParcela: 3, quantidadeParcelas: 60, parcelamento: { tipo: "PARCSN", numeroParcelamento: "123" },
      }],
      normais: [{
        portalClientId: PORTAL, tipo: "SIMPLES", status: "PROCESSED", extracted: null,
        id: "g-das", emailStatus: "SENT", emailSentAt: new Date("2026-06-01"),
        vazioEm: null, vazioPor: null, vazioMotivo: null,
      }],
    });
    // O DAS foi enviado; a parcela não. Cada nó tem o SEU envio — é o que garante que um não
    // contamina o outro.
    prisma.envioGuia.findMany.mockImplementation(async ({ where }) => (
      (where?.guideId?.in || []).includes("g-das")
        ? [{ guideId: "g-das", canal: "EMAIL", status: "enviado", enviadoEm: new Date("2026-06-01") }]
        : []
    ));

    const c = map(await computeGuideComplianceMap([linhaSimples], COMP));
    expect(c.das.state).toBe("enviada");
    expect(c.das.guideId).toBe("g-das");
    expect(c.parcDas.state).toBe("gerada");
    expect(c.parcDas.guideId).toBe("g-parc");
  });

  it("sem parcelamento nenhum, o nó `parcDas` não é exigido (chip não renderiza)", async () => {
    const c = map(await computeGuideComplianceMap([linhaSimples], COMP));
    expect(c.parcDas.required).toBe(false);
    expect(c.parcDas.state).toBe("na");
  });

  it("mês sem faturamento NÃO zera a parcela — receita zero não suspende parcelamento", async () => {
    prisma.companyMonthlyCircular.findMany.mockResolvedValue([{ portalClientId: PORTAL }]);
    mockGuides({ parcelas: [{ portalClientId: PORTAL, id: "g-parc", emailStatus: null, emailSentAt: null, numeroParcela: 1, quantidadeParcelas: 12, parcelamento: null }] });

    const c = map(await computeGuideComplianceMap([linhaSimples], COMP));
    expect(c.das.state).toBe("vazio");        // a afirmação vale para o DAS…
    expect(c.parcDas.state).toBe("gerada");   // …e não contamina a parcela
  });

  it("empresa cujo ÚNICO nó exigido é a parcela continua sendo resolvida", async () => {
    // Regressão do gating `needQuery`: sem regime no cadastro e sem pró-labore, nenhum tributo é
    // exigido. Antes a empresa saía do laço final e a parcela ficava `missing` para sempre.
    mockGuides({
      parcelas: [{
        portalClientId: "pc-sem-regime", id: "g-parc", emailStatus: "PENDING", emailSentAt: null,
        numeroParcela: 2, quantidadeParcelas: 24, parcelamento: { tipo: "PERT_SN", numeroParcelamento: "9" },
      }],
    });

    const c = (await computeGuideComplianceMap(
      [{ portalId: "pc-sem-regime", hasProlabore: false, legacy: null }], COMP,
    )).get("pc-sem-regime");

    expect(c.das.required).toBe(false);
    expect(c.parcDas.required).toBe(true);
    expect(c.parcDas.state).toBe("gerada");
  });

  it("parcelamento vindo do modal manual antigo (lançamento PARC_DAS) também exige o nó", async () => {
    // O caminho V1/manual é o único que grava `subtipo:"PARC_DAS"`. Sem guia capturada, a parcela
    // do mês está FALTANDO — e é isso que o chip precisa dizer.
    prisma.accountingEntry.findMany.mockResolvedValue([{ portalClientId: PORTAL }]);

    const c = map(await computeGuideComplianceMap([linhaSimples], COMP));
    expect(c.parcDas.required).toBe(true);
    expect(c.parcDas.state).toBe("missing");
    expect(c.ok).toBe(false);
  });
});

/** açúcar: pega a única empresa do mapa nos casos de uma linha só. */
function map(m) {
  return m.get(PORTAL) || m.values().next().value;
}
