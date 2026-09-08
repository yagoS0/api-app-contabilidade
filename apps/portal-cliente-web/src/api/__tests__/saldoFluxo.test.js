import { createRealApi } from "../real/realApi";
import { createMockApi } from "../mock/mockApi";
import { definirTokens, limparSessao } from "../sessionStore";
import { competenciaPadrao } from "../../lib/format";

afterEach(() => { jest.restoreAllMocks(); limparSessao(); });
test("competência navega janela e nunca redefine o relógio da API", async () => {
  const original = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
  try {
    await createRealApi().getFluxoCaixa("empresa", { competencia: "2025-01" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("janelaInicio=2025-01"); expect(url).not.toContain("cicloAtual");
    await createRealApi().salvarSaldoInicial("empresa", { dataReferencia: "2026-09-01", valor: "-50.25" });
    expect(global.fetch.mock.calls[1][0]).toContain("/fluxo-de-caixa/saldo-inicial");
    expect(global.fetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ dataReferencia: "2026-09-01", valor: "-50.25" }) });
    await createRealApi().excluirSaldoInicial("empresa"); expect(global.fetch.mock.calls[2][1].method).toBe("DELETE");
  } finally { global.fetch = original; }
});
test("mock persiste zero/negativo, exclui âncora e conserva hoje ao consultar passado", async () => {
  const api = createMockApi(), sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
  const hoje = competenciaPadrao();
  try {
    await api.salvarSaldoInicial("pc-001", { dataReferencia: `${hoje}-01`, valor: "-50.25" });
    const p = await api.getFluxoCaixa("pc-001", { competencia: "2025-01" });
    expect(p.cicloAtual).toBe(hoje); expect(p.saldoInicial.valor).toBe(-50.25);
    expect(p.meses.filter(m => m.competencia < hoje).every(m => m.saldo.inicial === null)).toBe(true);
    const atual = await api.getFluxoCaixa("pc-001");
    expect(atual.meses.find(m => m.competencia === hoje).saldo.inicial).toBe(-50.25);
    await api.excluirSaldoInicial("pc-001");
    const sem = await api.getFluxoCaixa("pc-001"); expect(sem.saldoInicial).toBeNull(); expect(sem.meses.every(m => m.saldo.final === null)).toBe(true);
  } finally { await api.excluirSaldoInicial("pc-001"); }
});
