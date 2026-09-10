import { createRealApi } from "../real/realApi";
import { createMockApi } from "../mock/mockApi";
import { fluxoDeCaixaDoMock } from "../mock/fluxoDeCaixaDoMock";
import { definirTokens, limparSessao } from "../sessionStore";
import { competenciaPadrao } from "../../lib/format";

afterEach(() => { jest.restoreAllMocks(); limparSessao(); });

test("competência navega janela sem redefinir relógio e API pública não oferece saldo manual", async () => {
  const original = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
  try {
    const api = createRealApi();
    await api.getFluxoCaixa("empresa", { competencia: "2025-01" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("janelaInicio=2025-01"); expect(url).not.toContain("cicloAtual");
    expect(api).not.toHaveProperty("salvarSaldoInicial");
    expect(api).not.toHaveProperty("excluirSaldoInicial");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally { global.fetch = original; }
});

test("mock calcula sem declaração e conserva hoje ao consultar passado", async () => {
  const api = createMockApi(), sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
  expect(api).not.toHaveProperty("salvarSaldoInicial");
  expect(api).not.toHaveProperty("excluirSaldoInicial");
  const hoje = competenciaPadrao();
  const p = await api.getFluxoCaixa("pc-001", { competencia: "2025-01" });
  expect(p.cicloAtual).toBe(hoje);
  expect(p.saldoInicial).toBeNull();
  expect(p.acumulado).toMatchObject({ origem: "HISTORICO" });
  const atual = await api.getFluxoCaixa("pc-001");
  expect(atual.meses.find(m => m.competencia === hoje).saldo.inicial).toEqual(expect.any(Number));
});

test("primeiro mês inicia automaticamente em zero e meses seguintes carregam fechamento anterior", () => {
  const p = fluxoDeCaixaDoMock("pc-001", "2026-09");
  expect(p.acumulado).toEqual({ origem: "HISTORICO", calculoInicio: "2026-05" });
  expect(p.meses[0].saldo.inicial).toBe(0);
  expect(p.meses[0].saldo.final).not.toBe(0);
  for (let i = 1; i < p.meses.length; i++) expect(p.meses[i].saldo.inicial).toBe(p.meses[i - 1].saldo.final);
  const ignorarLegado = fluxoDeCaixaDoMock("pc-001", "2026-09", { saldoInicial: { dataReferencia: "2026-05-01", valor: 999999 } });
  expect(ignorarLegado.meses.map(m => m.saldo)).toEqual(p.meses.map(m => m.saldo));
});

test("voltar janela não muda acumulado do mesmo mês e período anterior ao histórico fica desconhecido", () => {
  const atual = fluxoDeCaixaDoMock("pc-001", "2026-09");
  const antiga = fluxoDeCaixaDoMock("pc-001", "2026-09", { janelaInicio: "2026-01" });
  expect(antiga.meses.filter(m => m.competencia < "2026-05").every(m => m.saldo.inicial === null && m.saldo.final === null)).toBe(true);
  for (const mes of antiga.meses) {
    const mesmo = atual.meses.find(m => m.competencia === mes.competencia);
    if (mesmo) expect(mes.saldo).toEqual(mesmo.saldo);
  }
  const vazio = fluxoDeCaixaDoMock("pc-006", "2026-09");
  expect(vazio.acumulado).toEqual({ origem: "HISTORICO", calculoInicio: null });
  expect(vazio.meses.every(m => m.saldo.inicial === null && m.saldo.final === null)).toBe(true);
});
