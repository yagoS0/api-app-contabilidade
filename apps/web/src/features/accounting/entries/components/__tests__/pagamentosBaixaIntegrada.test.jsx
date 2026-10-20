import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PagamentosProvisionadosModal } from "../PagamentosProvisionadosModal";
const accounts = [{ codigo: "240", nome: "Simples a recolher", tipo: "PASSIVO" }, { codigo: "5", nome: "Caixa", tipo: "ATIVO" }];
function montar(comprovante, competencia = "2026-09", extra = {}) {
  const onSave = jest.fn();
  const entry = { id: "p", subtipo: "DAS", competencia: "2026-08", saldo: 100, totalD: 100,
    lines: [{ tipo: "C", conta: "240", valor: 100 }], comprovante, ...extra };
  const view = render(<PagamentosProvisionadosModal pendentes={{ itens: [entry], loading: false }} competencia={competencia}
    accounts={accounts} onSave={onSave} onClose={() => {}} />);
  fireEvent.click(screen.getByText("Dar baixa"));
  return { ...view, onSave };
}
test.each([{ dataArrecadacao: "20/09/2026" }, { dataArrecadacao: "2026-09-20" }, { dataArrecadacaoBR: "20/09/2026" }])(
  "modal real conserva data comprovada %j e exige contas", (dados) => {
    const { baseElement, onSave } = montar({ confiavel: true, ...dados });
    expect(baseElement.querySelector('input[type="date"]')).toHaveValue("2026-09-20");
    expect(screen.getByText("Confirmar Baixa")).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
test("pagamento de outro mês orienta abrir o mês real e preservar fechamento", () => {
  const { baseElement, onSave } = montar({ confiavel: true, dataArrecadacaoBR: "20/10/2026" });
  expect(baseElement.querySelector('input[type="date"]')).toHaveValue("2026-10-20");
  expect(screen.getByText(/Se o mês estiver fechado/)).toHaveTextContent("Corrigir mês fechado");
  expect(screen.getByText("Confirmar Baixa")).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});
test("comprovante sem data não presume hoje", () => {
  const { baseElement } = montar({ confiavel: true });
  expect(baseElement.querySelector('input[type="date"]')).toHaveValue("");
  expect(screen.getByText("Confirmar Baixa")).toBeDisabled();
});

function baixaPreparada(onSave = jest.fn(async () => ({ ok: true }))) {
  const entry = { id: "p", subtipo: "DAS", competencia: "2026-08", saldo: 100, totalD: 100,
    lines: [{ tipo: "C", conta: "240", valor: 100 }], comprovante: { confiavel: true, principal: 100, dataArrecadacaoBR: "20/09/2026" }, sourceGuide: { id: "g" } };
  const props = { pendentes: { itens: [entry], loading: false, reload: jest.fn(async () => {}) }, competencia: "2026-09", accounts, onSave, onClose: jest.fn(),
    onLoadBaixaTemplate: jest.fn(async () => ({ template: { debitAccountCode: "240", creditAccountCode: "5" }, saldoInfo: { principal: 100, abatido: 0, saldo: 100 } })) };
  const view = render(<PagamentosProvisionadosModal {...props} />);
  return { ...view, props, entry, onSave };
}
test("baixa real entrega data civil, principal e contas confirmadas", async () => {
  const t = baixaPreparada(); fireEvent.click(screen.getByText("Dar baixa"));
  await waitFor(() => expect(screen.getByText("Confirmar Baixa")).toBeEnabled());
  fireEvent.click(screen.getByText("Confirmar Baixa"));
  await waitFor(() => expect(t.onSave).toHaveBeenCalledWith("p", expect.objectContaining({ data: "2026-09-20", lines: expect.arrayContaining([expect.objectContaining({ conta: "240", tipo: "D", papel: "PRINCIPAL" }), expect.objectContaining({ conta: "5", tipo: "C" })]) })));
});
test.each([{ loading: true }, { error: "Leitura indisponível", anterior: true }, { anterior: true }])("baixa já aberta bloqueia leitura incerta %j", async patch => {
  const t = baixaPreparada(); fireEvent.click(screen.getByText("Dar baixa"));
  await waitFor(() => expect(screen.getByText("Confirmar Baixa")).toBeEnabled());
  t.rerender(<PagamentosProvisionadosModal {...t.props} pendentes={{ ...t.props.pendentes, ...patch }} />);
  expect(screen.getByText("Confirmar Baixa")).toBeDisabled();
  expect(screen.getByText(/Volte à lista e confirme/)).toBeVisible();
  fireEvent.click(screen.getByText("Confirmar Baixa")); expect(t.onSave).not.toHaveBeenCalled();
});
test("recarga com saldo alterado exige reabrir a baixa", async () => {
  const t = baixaPreparada(); fireEvent.click(screen.getByText("Dar baixa"));
  await waitFor(() => expect(screen.getByText("Confirmar Baixa")).toBeEnabled());
  t.rerender(<PagamentosProvisionadosModal {...t.props} pendentes={{ ...t.props.pendentes, itens: [{ ...t.entry, saldo: 50 }] }} />);
  expect(screen.getByText("Confirmar Baixa")).toBeDisabled(); expect(t.onSave).not.toHaveBeenCalled();
});
test("fechamento recusado ao salvar preserva data e formulário", async () => {
  const t = baixaPreparada(jest.fn(async () => { throw new Error("Mês fechado. Use Corrigir mês fechado."); }));
  fireEvent.click(screen.getByText("Dar baixa")); await waitFor(() => expect(screen.getByText("Confirmar Baixa")).toBeEnabled());
  fireEvent.click(screen.getByText("Confirmar Baixa"));
  expect(await screen.findByText("Mês fechado. Use Corrigir mês fechado.")).toBeVisible();
  expect(t.props.onClose).not.toHaveBeenCalled();
  expect(t.baseElement.querySelector('input[type="date"]')).toHaveValue("2026-09-20");
});
test("consulta falha não fabrica pagamento nem baixa", async () => {
  const t = baixaPreparada();
  t.rerender(<PagamentosProvisionadosModal {...t.props} onBuscarPagamento={async () => { throw new Error("Consulta indisponível"); }} />);
  fireEvent.click(screen.getByText("Buscar pagamento"));
  expect(await screen.findByText("Consulta indisponível")).toBeVisible();
  expect(t.onSave).not.toHaveBeenCalled(); expect(t.props.pendentes.reload).not.toHaveBeenCalled();
});