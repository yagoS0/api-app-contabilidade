import { fireEvent, render, screen, waitFor } from "@testing-library/react";
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({}) }));
import { GuiasPendentesContabilizacao } from "../GuiasPendentesContabilizacao";
const guia = { id: "g1", tipo: "DARF", valor: 217.58, updatedAt: "2026-10-15T18:00:00Z" };
let api;
beforeEach(() => { api = { getGuiasPendentesContabilizacao: jest.fn(async () => ({ itens: [guia] })), contabilizarGuiaPendente: jest.fn(async () => ({ ok: true })) }; });
function montar(props = {}) { return render(<GuiasPendentesContabilizacao companyId="c1" competencia="2026-09" fechado apiClient={api} {...props} />); }
test("pendência permanece visível no mês fechado sem oferecer contabilização", async () => {
  montar();
  expect(await screen.findByText(/Guia pendente de contabilização/)).toBeInTheDocument();
  expect(screen.getByText(/Reabra o mês/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Contabilizar guia" })).not.toBeInTheDocument();
});
test("mês reaberto permite contabilizar uma vez e atualizar os lançamentos", async () => {
  const aoContabilizar = jest.fn(); montar({ fechado: false, aoContabilizar });
  fireEvent.click(await screen.findByRole("button", { name: "Contabilizar guia" }));
  await waitFor(() => expect(aoContabilizar).toHaveBeenCalledTimes(1));
  expect(api.contabilizarGuiaPendente).toHaveBeenCalledWith("c1", "g1", guia.updatedAt);
  expect(screen.queryByText(/Guia pendente de contabilização/)).not.toBeInTheDocument();
});
test("recusa mantém guia e motivo visíveis", async () => {
  api.contabilizarGuiaPendente.mockRejectedValue(new Error("Reabra o mês antes de contabilizar esta guia."));
  montar({ fechado: false });
  fireEvent.click(await screen.findByRole("button", { name: "Contabilizar guia" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Reabra o mês");
  expect(screen.getByText(/Guia pendente de contabilização/)).toBeInTheDocument();
});
test("resposta atrasada de outra empresa não aparece na empresa atual", async () => {
  let resolver;
  api.getGuiasPendentesContabilizacao.mockImplementation(id => id === "c1" ? new Promise(r => { resolver = r; }) : Promise.resolve({ itens: [] }));
  const view = montar();
  view.rerender(<GuiasPendentesContabilizacao companyId="c2" competencia="2026-09" fechado apiClient={api} />);
  resolver({ itens: [guia] });
  await waitFor(() => expect(api.getGuiasPendentesContabilizacao).toHaveBeenCalledWith("c2", "2026-09"));
  expect(screen.queryByText(/Guia pendente de contabilização/)).not.toBeInTheDocument();
});
