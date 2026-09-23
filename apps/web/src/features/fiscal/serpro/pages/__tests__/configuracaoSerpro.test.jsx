import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SerproSettingsPage } from "../renderSerproSettingsPage";
const view = props => <MemoryRouter><SerproSettingsPage {...props} /></MemoryRouter>;
it("não mostra certificado ausente nem permite salvar antes da leitura", () => {
  render(view({ settings: null, settingsStatus: "loading" }));
  expect(screen.queryByText("Ausente")).toBeNull();
  expect(screen.getByRole("button", { name: "Salvar configuração" })).toBeDisabled();
});
it("mostra falha e tentar novamente sem inventar ausência", () => {
  const onRetrySettings = jest.fn();
  render(view({ settings: null, settingsStatus: "error", settingsError: "Falha de conexão", onRetrySettings }));
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(onRetrySettings).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Ausente")).toBeNull();
});
it("preserva campos editados ao atualizar metadados do certificado", () => {
  const settings = { enabled: true, consumerKey: "chave", certificate: { hasCertificate: true } };
  const { rerender } = render(view({ settings, settingsStatus: "ready" }));
  fireEvent.change(screen.getByLabelText("Consumer Key"), { target: { value: "edição" } });
  rerender(view({ settings: { ...settings, certificate: { hasCertificate: false } }, settingsStatus: "ready" }));
  expect(screen.getByLabelText("Consumer Key")).toHaveValue("edição");
  expect(screen.getByText("Ausente")).toBeInTheDocument();
});
