import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { PayrollEntryModal } from "../renderAccountingEntriesParts.jsx";

const template = (valor = 1100) => ({ template: {
  kind: "PROLABORE", valorRetencaoInss: null,
  inssGuide: { valor }, lines: [
    { side: "D", role: "salary", historico: "PRÓ-LABORE", accountCode: "10" },
    { side: "C", role: "inss", historico: "INSS", accountCode: "20" },
    { side: "C", role: "liquid", historico: "LÍQUIDO", accountCode: "30" },
  ], baixa: null,
} });
const props = { companyId: "a", accounts: [], defaultCompetencia: "2026-08", onSave: jest.fn(), onClose: jest.fn(), saving: false };
const valores = () => within(screen.getByRole("table")).getAllByRole("spinbutton");

test("guia atualizada não preenche retenção; edição sobrevive a novo callback e cálculo do líquido", async () => {
  const carregar = jest.fn().mockResolvedValue(template());
  const tela = render(<PayrollEntryModal {...props} onLoadTemplate={carregar} />);
  await screen.findByRole("table");
  expect(valores()[1]).toHaveValue(null);
  fireEvent.change(valores()[0], { target: { value: "5000" } });
  fireEvent.change(valores()[1], { target: { value: "1000" } });
  expect(valores()[2]).toHaveValue(4000);
  const outroCallback = jest.fn().mockResolvedValue(template(1200));
  tela.rerender(<PayrollEntryModal {...props} onLoadTemplate={outroCallback} />);
  await act(async () => {});
  expect(outroCallback).not.toHaveBeenCalled();
  expect(valores()[1]).toHaveValue(1000);
  expect(valores()[2]).toHaveValue(4000);
});

test("resposta de empresa anterior não invade a nova empresa", async () => {
  let responderA;
  const carregarA = jest.fn(() => new Promise((resolve) => { responderA = resolve; }));
  const tela = render(<PayrollEntryModal {...props} key="a" onLoadTemplate={carregarA} />);
  tela.rerender(<PayrollEntryModal {...props} companyId="b" key="b" onLoadTemplate={jest.fn().mockResolvedValue(template(900))} />);
  await screen.findByRole("table");
  fireEvent.change(valores()[1], { target: { value: "300" } });
  await act(async () => responderA(template(9999)));
  expect(valores()[1]).toHaveValue(300);
  expect(screen.queryByText(/9.999,00/)).not.toBeInTheDocument();
});

test("resposta de competência antiga não substitui valores da nova competência", async () => {
  let responderAntiga;
  const carregar = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { responderAntiga = resolve; }))
    .mockResolvedValue(template(900));
  render(<PayrollEntryModal {...props} onLoadTemplate={carregar} />);
  fireEvent.change(screen.getByLabelText(/Competência/), { target: { value: "2026-09" } });
  await screen.findByRole("table");
  fireEvent.change(valores()[1], { target: { value: "300" } });
  await act(async () => responderAntiga(template(9999)));
  expect(valores()[1]).toHaveValue(300);
});
