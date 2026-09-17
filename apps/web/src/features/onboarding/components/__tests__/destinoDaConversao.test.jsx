import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OnboardingDetailPage } from "../../pages/renderOnboardingDetailPage";
jest.mock("../ConversaoModal", () => ({ ConversaoModal: ({ onConverter, erro }) => <div><button onClick={() => onConverter({ company: { cnpj: "11222333000181" } })}>Confirmar revisão sintética</button>{erro && <span role="alert">{erro.message}</span>}</div> }));
const ficha = { id: "onb", origem: "ABERTURA", status: "EM_TRILHA", dados: {}, etapas: [] };
test("conversão confirmada termina no cadastro da empresa criada", async () => {
  const abrir = jest.fn(), api = { getOnboarding: jest.fn().mockResolvedValue({ onboarding: ficha }), converterOnboarding: jest.fn().mockResolvedValue({ portalClientId: "nova-empresa", onboarding: { ...ficha, status: "CONVERTIDO", portalClientId: "nova-empresa" } }) };
  render(<OnboardingDetailPage api={api} onboardingId="onb" onAbrirEmpresa={abrir} />);
  fireEvent.click(await screen.findByRole("button", { name: "Adicionar à carteira" })); fireEvent.click(screen.getByText("Confirmar revisão sintética"));
  await waitFor(() => expect(abrir).toHaveBeenCalledWith("nova-empresa", "cadastro"));
});
test("falha de arquivo conserva a revisão aberta e não navega para uma empresa inexistente", async () => {
  const abrir = jest.fn(), api = { getOnboarding: jest.fn().mockResolvedValue({ onboarding: ficha }), converterOnboarding: jest.fn().mockRejectedValue(new Error("Não foi possível arquivar todos os documentos")) };
  render(<OnboardingDetailPage api={api} onboardingId="onb" onAbrirEmpresa={abrir} />);
  fireEvent.click(await screen.findByRole("button", { name: "Adicionar à carteira" })); fireEvent.click(screen.getByText("Confirmar revisão sintética"));
  expect(await screen.findByRole("alert")).toHaveTextContent("arquivar todos os documentos"); expect(abrir).not.toHaveBeenCalled();
});
