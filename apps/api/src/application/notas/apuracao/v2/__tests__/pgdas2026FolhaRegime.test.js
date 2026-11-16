jest.mock("../../../../../infrastructure/db/prisma.js", () => ({
  prisma: { companyMonthlyCircular: { findFirst: jest.fn() } },
}));
import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { competenciasDe12Meses, compararFolha12m } from "../FolhaDerivadaService.js";
import { decidirFatorR, resolverFolha12m } from "../FatorRService.js";
import { criarVinculoCalculo, validarCalculoConfirmado, insumosFormulario } from "../CalculoConfirmado.js";

beforeEach(() => jest.resetAllMocks());

describe("PGDAS-2026-A — fatos do legado, não nova regra fiscal", () => {
  test.each([
    ["2026-10", "2025-10", "2026-09"], ["2026-11", "2025-11", "2026-10"],
    ["2026-12", "2025-12", "2026-11"], ["2027-01", "2026-01", "2026-12"],
  ])("janela atual %s: %s a %s, sem especialização por abertura", (pa, inicio, fim) => {
    const janela = competenciasDe12Meses(pa);
    expect(janela).toHaveLength(12);
    expect(janela[0]).toBe(inicio);
    expect(janela[11]).toBe(fim);
    expect(janela).not.toContain(pa);
    expect(new Set(janela).size).toBe(12);
  });
  test.each([null, undefined, ""])("conferência não confunde ausente %p com zero", digitada => {
    expect(compararFolha12m({ derivada: 0, digitada })).toEqual({ comparavel: false });
  });
  test("zero explícito é comparável, sem atestar procedência documental", () => {
    expect(compararFolha12m({ derivada: 0, digitada: 0 })).toMatchObject({ comparavel: true, confere: true });
  });
  test("FS12 atual zero prevalece sobre mês anterior", async () => {
    prisma.companyMonthlyCircular.findFirst.mockResolvedValueOnce({ fs12Manual: 0, fs12Origem: "MANUAL" });
    expect(await resolverFolha12m({ portalClientId: "sintetica", competencia: "2026-11" }))
      .toEqual({ folha12m: 0, origem: "MANUAL", fonte: "competencia_atual" });
    expect(prisma.companyMonthlyCircular.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.companyMonthlyCircular.findFirst.mock.calls[0][0].where.portalClientId).toBe("sintetica");
  });
  test("ausência atual retorna agregado anterior como sugestão, não evidência da janela atual", async () => {
    prisma.companyMonthlyCircular.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ fs12Manual: "1000", fs12Origem: "MANUAL", competencia: "2026-10" });
    expect(await resolverFolha12m({ portalClientId: "sintetica", competencia: "2026-11" }))
      .toMatchObject({ folha12m: 1000, fonte: "sugestao_de_2026-10" });
    expect(prisma.companyMonthlyCircular.findFirst.mock.calls[1][0].where)
      .toMatchObject({ portalClientId: "sintetica", competencia: { lt: "2026-11" } });
  });
  test("nenhuma fonte permanece ausente no resolvedor", async () => {
    prisma.companyMonthlyCircular.findFirst.mockResolvedValue(null);
    expect(await resolverFolha12m({ portalClientId: "sintetica", competencia: "2026-11" }))
      .toEqual({ folha12m: null, origem: null, fonte: null });
  });
  test.each([[280, 1000, 0.28, "III"], [279, 1000, 0.279, "V"], [0, 0, 0, "V"], [100, 0, 0, "V"]])(
    "Fator R legado %p/%p = %p anexo %s, inclusive limitação de receita zero", (folha12m, rbt12, fatorR, anexoDecidido) => {
      expect(decidirFatorR({ folha12m, rbt12 })).toMatchObject({ fatorR, anexoDecidido });
    });
  test("folhas aceitas ficam no token; alterá-las invalida confirmação, sem substituir histórico", () => {
    const formulario = insumosFormulario({ atividades: [], folhaMensal12: [{ pa: 202610, valor: 0 }] });
    const vinculo = criarVinculoCalculo({ portalClientId: "sintetica", competencia: "2026-11",
      formulario, receitasBrutasAnteriores: [], folhasSalario: [{ pa: 202610, valor: 0 }] });
    const snapshot = { idempotencyKey: vinculo.calculoId, atividadesEscolhidas: formulario.atividades,
      folhaMensal12: formulario.folhaMensal12, simulacaoSerpro: { _portalCalculo: vinculo } };
    const args = { portalClientId: "sintetica", competencia: "2026-11", calculoId: vinculo.calculoId, formulario };
    expect(() => validarCalculoConfirmado(snapshot, args)).not.toThrow();
    const alterado = JSON.parse(JSON.stringify(snapshot));
    alterado.simulacaoSerpro._portalCalculo.folhasSalario[0].valor = 1;
    expect(() => validarCalculoConfirmado(alterado, args)).toThrow();
    expect(snapshot.simulacaoSerpro._portalCalculo.folhasSalario[0].valor).toBe(0);
  });
});
