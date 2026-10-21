import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AutorizacaoDoLead } from "../AutorizacaoDoLead";
test("ficha manual sem atendimento oferece preparo explícito, sem fabricar representante", async () => {
  const api = { comercial: jest.fn(async () => ({ versao: 1, retorno: null })) };
  render(<MemoryRouter><AutorizacaoDoLead api={api} estado={{ onboarding: { id: "o", cnpj: "12345678000190" } }} /></MemoryRouter>);
  expect(screen.getByText(/Prepare ou vincule/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar contato" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: /Registrar conferência/ })).not.toBeInTheDocument();
  expect(api.comercial).toHaveBeenCalledWith("/onboardings/o/acompanhamento");
});
