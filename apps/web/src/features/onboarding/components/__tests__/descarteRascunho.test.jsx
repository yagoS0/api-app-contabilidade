import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { OnboardingsPage } from "../../pages/renderOnboardingsPage";

const item = { id: "rascunho-teste", origem: "ABERTURA", status: "RASCUNHO", responsavelNome: "Contato de teste" };
function montar(descartarOnboarding = jest.fn()) {
  const api = { listarOnboardings: jest.fn().mockResolvedValue({ itens: [item] }), descartarOnboarding };
  const abrir = jest.fn(); render(<OnboardingsPage api={api} onAbrir={abrir} />);
  return { api, abrir };
}

test("cancelar o descarte não chama a API", async () => {
  const { api } = montar();
  fireEvent.click(await screen.findByRole("button", { name: "descartar rascunho" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
  expect(api.descartarOnboarding).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Contato de teste" })).toBeVisible();
});

test("recusa de ficha vinculada fica visível e permite conferir sem apagar histórico", async () => {
  const { api, abrir } = montar(jest.fn().mockRejectedValue(new Error("Este atendimento possui conversa vinculada. Use desistência para preservar o histórico.")));
  fireEvent.click(await screen.findByRole("button", { name: "descartar rascunho" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar rascunho" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Use desistência para preservar o histórico");
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar rascunho" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Abrir ficha para conferir" }));
  expect(abrir).toHaveBeenCalledWith(item);
  expect(api.descartarOnboarding).toHaveBeenCalledTimes(1);
});

test("descarte confirmado atualiza a lista e fecha o diálogo", async () => {
  const { api } = montar(jest.fn().mockResolvedValue({ ok: true }));
  fireEvent.click(await screen.findByRole("button", { name: "descartar rascunho" }));
  api.listarOnboardings.mockResolvedValue({ itens: [] });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar rascunho" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Contato de teste" })).not.toBeInTheDocument();
  expect(api.descartarOnboarding).toHaveBeenCalledWith(item.id);
});
