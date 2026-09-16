import { resumirCenario, ordenarCenarios, carregarCarteira, moedaCenario, totalDoRegime } from "../cenariosSalvos";

const hoje = new Date(2026, 8, 15);
function foto() { return { id: "c1", geradoEm: "2026-09-01", resultado: { anoBase: 2026, comparacaoCompleta: true, regimeAtual: "Lucro Presumido", economiaVsAtual: 999999,
  regimes: [{ regime: "Simples Nacional", total: 90000, cobertura: { estado: "estimado" } }, { regime: "Lucro Presumido", total: 110000, cobertura: { estado: "estimado" } }] } }; }

test("diferença usa os totais salvos versus regime atual, sem confiar no campo agregado", () => {
  expect(resumirCenario(foto(), hoje)).toMatchObject({ estado: "oportunidade", economia: 20000 });
});
test.each(["parcial", undefined])("cobertura %s nunca produz oportunidade", cobertura => {
  const c = foto(); c.resultado.regimes[0].cobertura.estado = cobertura;
  expect(resumirCenario(c, hoje)).toMatchObject({ estado: "parcial", economia: null });
});
test("cenário legado e ausência de cenário não viram zero", () => {
  expect(resumirCenario(null, hoje).estado).toBe("sem_cenario");
  const c = foto(); delete c.resultado.comparacaoCompleta;
  expect(resumirCenario(c, hoje).economia).toBeNull();
  expect(moedaCenario(null)).toBe("Não informado");
  expect(moedaCenario(0)).toMatch(/0,00/);
  expect(totalDoRegime({ total: 0, indisponivel: true })).toBeNull();
});
test.each(["2026-09-14", "2026-09-15"])("revisão %s impede indicação de potencial", revisarEm => {
  const c = foto(); c.resultado.conclusao = { revisarEm };
  expect(resumirCenario(c, hoje)).toMatchObject({ estado: "revisar", economia: null });
});
test("ano anterior, regime não informado e economia zero têm estados próprios", () => {
  const c = foto(); c.resultado.anoBase = 2025;
  expect(resumirCenario(c, hoje).estado).toBe("revisar");
  c.resultado.anoBase = 2026; c.resultado.regimeAtual = null;
  expect(resumirCenario(c, hoje).estado).toBe("sem_base");
  c.resultado.regimeAtual = "Simples Nacional";
  expect(resumirCenario(c, hoje)).toMatchObject({ estado: "sem_reducao", economia: 0 });
});
test("seleciona a foto mais recente sem alterar a lista original", () => {
  const lista = [{ id: "antigo", geradoEm: "2026-01-01" }, { id: "novo", geradoEm: "2026-08-01" }];
  expect(ordenarCenarios(lista)[0].id).toBe("novo"); expect(lista[0].id).toBe("antigo");
});
test("isola falhas por empresa, rejeita foto de outra empresa e remove duplicadas", async () => {
  const api = { listarSimulacoesPlanejamento: jest.fn(async id => id === "a" ? { simulacoes: [foto()] } : id === "b" ? { ok: false } : { simulacoes: [{ ...foto(), portalClientId: "fora" }] }) };
  const r = await carregarCarteira({ empresas: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "a" }], api });
  expect(api.listarSimulacoesPlanejamento).toHaveBeenCalledTimes(3);
  expect(r.find(x => x.id === "a").cenario.id).toBe("c1");
  expect(r.filter(x => x.erro)).toHaveLength(2);
});
test("limita concorrência e para novas consultas ao cancelar", async () => {
  const respostas = []; let cancelar = false;
  const api = { listarSimulacoesPlanejamento: jest.fn(() => new Promise(resolve => respostas.push(resolve))) };
  const progresso = jest.fn();
  const promise = carregarCarteira({ empresas: Array.from({ length: 9 }, (_, i) => ({ id: String(i) })), api, cancelado: () => cancelar, progresso });
  expect(api.listarSimulacoesPlanejamento).toHaveBeenCalledTimes(3);
  cancelar = true; respostas.forEach(resolve => resolve({ simulacoes: [] }));
  await promise;
  expect(api.listarSimulacoesPlanejamento).toHaveBeenCalledTimes(3);
  expect(progresso).not.toHaveBeenCalled();
});
