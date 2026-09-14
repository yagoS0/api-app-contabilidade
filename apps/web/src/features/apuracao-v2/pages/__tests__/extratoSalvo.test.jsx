import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ApuracaoV2Tab } from "../renderApuracaoV2Tab";

const salvo = { dados: { receitaBruta: 10000, dasTotal: 600 }, files: { declaracaoFileId: "pdf-1" }, consultadoEm: "2026-09-01" };
const panel = { pendencias: [] };
const feedback = {};
function cliente() {
  return {
    getFechamento: jest.fn(async () => ({ dados: { entregaPgdas: { extratoSalvo: salvo } } })),
    getApuracaoSnapshot: jest.fn(async () => ({ snapshot: null })),
    getRelatorioFaturamento: jest.fn(async () => ({ relatorio: null })),
    syncPgdasCircular: jest.fn(async () => ({ ok: true, result: salvo })),
  };
}
const tela = (api, competencia = "2026-08") => <ApuracaoV2Tab api={api} companyId="empresa-1" competencia={competencia} panel={panel} feedback={feedback} />;

it("abre extrato salvo sem consultar a Receita e atualiza apenas por ação explícita", async () => {
  const api = cliente();
  render(tela(api));
  expect(await screen.findByText(/Extrato salvo/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Buscar extrato" })).toBeNull();
  expect(screen.getByRole("button", { name: "Declaração (PDF)" })).toBeEnabled();
  expect(api.syncPgdasCircular).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Atualizar na Receita" }));
  await waitFor(() => expect(api.syncPgdasCircular).toHaveBeenCalledWith("empresa-1", "2026-08", { atualizar: true }));
});

it("resposta de outra competência não repõe extrato nem prende o carregamento", async () => {
  let resolver;
  const api = cliente();
  api.syncPgdasCircular.mockImplementation(() => new Promise(r => { resolver = r; }));
  const { rerender } = render(tela(api));
  await screen.findByText(/Extrato salvo/);
  fireEvent.click(screen.getByRole("button", { name: "Atualizar na Receita" }));
  api.getFechamento.mockResolvedValue({ dados: {} });
  rerender(tela(api, "2026-09"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Buscar extrato" })).toBeEnabled());
  await act(async () => resolver({ ok: true, result: salvo }));
  expect(screen.queryByText(/Extrato salvo/)).toBeNull();
  expect(screen.getByRole("button", { name: "Atualizar na Receita" })).toBeEnabled();
});
