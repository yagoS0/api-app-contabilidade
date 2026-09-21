import { fireEvent, render, screen } from "@testing-library/react";
import { AtendimentoComercial } from "../AtendimentoComercial";

jest.mock("../../../onboarding/components/FluxoComercial", () => ({
  FluxoComercial: () => <label>Rascunho da proposta<input /></label>,
}));

test("ficha abre separadamente e cancelar o recomeço mantém o processo e o rascunho sem enviar", async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ atendimento: { id: "lead", onboardingId: "ficha-1" } }) };
  render(<AtendimentoComercial api={api} conversa={{ id: "conversa-1" }} />);
  const link = await screen.findByRole("link", { name: "Abrir ficha do cliente em nova aba" });
  expect(link).toHaveAttribute("href", "/onboardings/ficha-1");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.queryByRole("group", { name: "Recomeçar atendimento" })).not.toBeInTheDocument();
  const campo = screen.getByLabelText("Rascunho da proposta");
  expect(campo).toBeVisible();
  fireEvent.change(campo, { target: { value: "Proposta em preparação" } });
  fireEvent.click(screen.getByRole("button", { name: "Recomeçar", exact: true }));
  expect(screen.getByRole("group", { name: "Recomeçar atendimento" })).toBeVisible();
  expect(campo).toBeVisible();
  expect(campo).toHaveValue("Proposta em preparação");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar", exact: true }));
  expect(screen.queryByRole("group", { name: "Recomeçar atendimento" })).not.toBeInTheDocument();
  expect(campo).toBeVisible();
  expect(campo).toHaveValue("Proposta em preparação");
  expect(api.comercial.mock.calls).toEqual([["/conversas/conversa-1"]]);
});
