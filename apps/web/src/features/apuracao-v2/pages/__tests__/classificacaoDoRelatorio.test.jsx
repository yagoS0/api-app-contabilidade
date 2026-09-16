import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { ApuracaoV2Tab } from "../renderApuracaoV2Tab";

const antigo = { dados: {
  naoClassificado: { valorContabil: 1000, itens: 1, comoResolver: "Aba Apuração → botão de classificação (no alto, ao lado de Calcular)" },
  preApurado: { ok: false, motivo: { code: "RECEITA_NAO_CLASSIFICADA" }, comoResolver: "Aba Apuração → botão de classificação" },
  totalMes: { valorContabil: 1000 },
} };
function montar() {
  const api = {
    getFechamento: jest.fn(async () => ({ dados: {} })),
    getApuracaoSnapshot: jest.fn(async () => ({ snapshot: null })),
    getRelatorioFaturamento: jest.fn(async () => ({ relatorio: antigo })),
    gerarRelatorioFaturamento: jest.fn(async () => ({ ok: true, relatorio: { dados: {
      naoClassificado: { valorContabil: 0, itens: 0 }, preApurado: { ok: true, das: 60 }, totalMes: { valorContabil: 1000 },
    } } })),
    syncPgdasCircular: jest.fn(),
  };
  const panel = { pendencias: [], classificarV2: jest.fn(async () => ({})) };
  const feedback = {};
  const tela = competencia => <ApuracaoV2Tab api={api} panel={panel} feedback={feedback} companyId="empresa-1" competencia={competencia} />;
  const view = render(tela("2026-08"));
  return { api, panel, tela, ...view };
}

it("relatório histórico abre a classificação e é regenerado após classificar a competência", async () => {
  const { api, panel } = montar();
  await screen.findByText("Há receita sem classificação nesta competência");
  expect(screen.queryByText(/botão de classificação/)).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Revisar classificação" })[1]);
  const modal = within(screen.getByRole("dialog"));
  expect(modal.getByText("Classificação das notas — 2026-08")).toBeInTheDocument();
  fireEvent.click(modal.getByRole("button", { name: "Classificar competência" }));
  await waitFor(() => expect(api.gerarRelatorioFaturamento).toHaveBeenCalledWith("empresa-1", "2026-08"));
  expect(panel.classificarV2).toHaveBeenCalledWith({ competencia: "2026-08" });
  await waitFor(() => expect(screen.queryByText("Há receita sem classificação nesta competência")).toBeNull());
  expect(screen.getByText("R$ 60,00")).toBeInTheDocument();
  expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});

it("classificação da competência anterior não regenera relatório após trocar de mês", async () => {
  const { api, panel, rerender, tela } = montar();
  let resolver;
  panel.classificarV2.mockImplementation(() => new Promise(r => { resolver = r; }));
  await screen.findByText("Há receita sem classificação nesta competência");
  fireEvent.click(screen.getAllByRole("button", { name: "Revisar classificação" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "Classificar competência" }));
  rerender(tela("2026-09"));
  await act(async () => resolver({}));
  expect(api.gerarRelatorioFaturamento).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});
