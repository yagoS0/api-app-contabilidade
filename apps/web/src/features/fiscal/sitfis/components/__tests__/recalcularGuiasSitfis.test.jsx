import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RecalcularGuiasSitfis } from "../RecalcularGuiasSitfis";
import { SitfisTab } from "../renderSitfisTab";

const das = (changes = {}) => ({ guideId: "das", tipo: "SIMPLES", competencia: "2026-05", valor: 100, canRecalculate: true, paymentStatus: "OPEN", vencida: true, ...changes });
function setup(guides, extras = {}, feedback = {}) {
  const panel = { guides, onRecalculateGuide: jest.fn().mockResolvedValue(undefined), onRecalcularInss: jest.fn().mockResolvedValue(undefined), ...extras };
  const view = render(<RecalcularGuiasSitfis guidesPanel={panel} feedback={feedback} />);
  fireEvent.click(screen.getByText("Recalcular guias"));
  return { panel, ...view };
}
function escolher(id) {
  fireEvent.change(screen.getByRole("combobox", { name: "Guia para recalcular" }), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
}

it("abre sem chamar SERPRO e prioriza vencidas conforme o servidor, sem vincular débitos", () => {
  const { panel } = setup([das(), das({ guideId: "futura", vencida: false, competencia: "2026-09" }), das({ guideId: "paga", paymentStatus: "PAID" })]);
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.getByText(/Os débitos do relatório não são vinculados automaticamente/)).toBeInTheDocument();
  expect(panel.onRecalculateGuide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Mostrar também guias não vencidas"));
  expect(screen.getAllByRole("option")).toHaveLength(3);
});

it("mantém parcela e guia sem serviço visíveis com motivo, mas não recalculáveis", () => {
  setup([das({ parcelamentoId: "parc" }), das({ guideId: "outra", tipo: "OUTRA", canRecalculate: false })]);
  expect(screen.getByRole("option", { name: /use a área de parcelamentos/ })).toBeDisabled();
  expect(screen.getByRole("option", { name: /recálculo indisponível para esta guia/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Recalcular" })).toBeDisabled();
});

it("confirma DAS por ID, comunica o e-mail e bloqueia dois cliques durante a chamada", async () => {
  let finish;
  const request = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  setup([das({ avisoDeRecalculo: { texto: "Aviso recebido do servidor." } })], { onRecalculateGuide: request });
  escolher("das");
  expect(screen.getByText("Aviso recebido do servidor.")).toBeInTheDocument();
  expect(screen.getByText(/também pode enviar a nova guia por e-mail/)).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  const confirm = screen.getByRole("button", { name: "Confirmar recálculo" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("das");
  expect(screen.getByRole("button", { name: "Recalculando…" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => finish());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/recalculada com sucesso/i)).not.toBeInTheDocument();
});

it("INSS usa a competência e DARF usa a espécie declarada pelo servidor", async () => {
  const { panel } = setup([das({ guideId: "inss", tipo: "INSS", canRecalculate: false }), das({ guideId: "lp", tipo: "OUTRA", especieRecalculo: "DARF_PRESUMIDO" })]);
  escolher("inss");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recálculo" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(panel.onRecalcularInss).toHaveBeenCalledWith("2026-05");
  expect(panel.onRecalculateGuide).not.toHaveBeenCalled();
  escolher("lp");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recálculo" }));
  await waitFor(() => expect(panel.onRecalculateGuide).toHaveBeenCalledWith("lp"));
});

it("revalida pagamento antes de confirmar e conserva feedback fora do relatório", async () => {
  const { panel, rerender } = setup([das()]);
  escolher("das");
  rerender(<RecalcularGuiasSitfis guidesPanel={{ ...panel, guides: [das({ paymentStatus: "PAID" })] }} feedback={{ error: "Falha no recálculo do SERPRO" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recálculo" }));
  expect(panel.onRecalculateGuide).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("não está mais disponível");
});

it("SITFIS oferece recálculo mesmo sem relatório, sem realizar uma consulta fiscal", () => {
  const consultar = jest.fn();
  render(<SitfisTab sitfisPanel={{ status: null, consultar }} guidesPanel={{ guides: [das()] }} feedback={{ error: "Falha ao recalcular guia" }} />);
  expect(screen.getByText("Recalcular guias")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Falha ao recalcular guia");
  expect(screen.queryByText("Tentar ler o relatório salvo novamente")).not.toBeInTheDocument();
  expect(consultar).not.toHaveBeenCalled();
});

it('atalho do topo abre a área de recálculo sem chamar serviços', () => {
  const consultar = jest.fn(), recalcular = jest.fn();
  render(<SitfisTab sitfisPanel={{ status: null, consultar }} guidesPanel={{ guides: [das()], onRecalculateGuide: recalcular }} />);
  const details = screen.getByText('Recalcular guias').closest('details');
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Recalcular guia' }));
  expect(details.open).toBe(true); expect(consultar).not.toHaveBeenCalled(); expect(recalcular).not.toHaveBeenCalled();
});

it('relatório salvo não cria outro acesso para a aba Guias', () => {
  render(<SitfisTab companyId="empresa" sitfisPanel={{ status: { situacao: "REGULAR" } }} guidesPanel={{ guides: [] }} />);
  expect(screen.queryByRole('link', { name: /Abrir guias da empresa/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recalcular guia' })).toBeInTheDocument();
});
