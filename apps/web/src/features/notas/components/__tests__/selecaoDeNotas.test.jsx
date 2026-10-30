import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotasList } from "../NotasList";
import { somenteServicosSemIE } from "../../lib/janelasDeNotas";
const notas = [{ id: "1", numero: "101", type: "NFSE", papel: "DEST" }, { id: "2", numero: "102", type: "NFSE", papel: "DEST" }];
const props = { notas, total: 2, filters: { competencia: "2026-08", papel: "DEST" }, onFiltersChange: jest.fn(), onApply: jest.fn(), onAbrirNota: jest.fn() };
it.each([
  ['2026-08-01', '2026-08-31', '01/08/2026 até 31/08/2026'],
  ['', '2026-08-31', 'Sem início até 31/08/2026'],
  ['2026-08-01', '', '01/08/2026 até Sem fim'],
])('mantém o intervalo aplicado visível no filtro recolhido (%s, %s)', (dataInicio, dataFim, texto) => {
  render(<NotasList {...props} filters={{ ...props.filters, dataInicio, dataFim }} />);
  const summary = screen.getByText(`Data de emissão · ${texto}`);
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  fireEvent.click(summary);
  expect(summary).toBeVisible();
  expect(props.onFiltersChange).not.toHaveBeenCalled();
});
beforeEach(() => { jest.clearAllMocks(); URL.createObjectURL = jest.fn(() => "blob:teste"); URL.revokeObjectURL = jest.fn(); });
it("seleciona duas notas sem abrir o detalhe e baixa exatamente a seleção", async () => {
  const baixar = jest.fn().mockResolvedValue({ blob: new Blob(["zip"]), geradas: 2, falhas: 0 });
  render(<NotasList {...props} onBaixarSelecionadas={baixar} />);
  fireEvent.click(screen.getByLabelText("Selecionar nota 101"));
  fireEvent.click(screen.getByLabelText("Selecionar nota 102"));
  expect(props.onAbrirNota).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Baixar XML" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Baixar DANFE / DANFSe" }));
  await waitFor(() => expect(baixar).toHaveBeenCalledWith(["1", "2"], "PDF"));
  expect(await screen.findByText("2 arquivo(s) baixado(s).")).toBeInTheDocument();
});
it("limpa seleção ao trocar competência e permite selecionar toda a página", () => {
  const baixar = jest.fn();
  const { rerender } = render(<NotasList {...props} onBaixarSelecionadas={baixar} />);
  fireEvent.click(screen.getByLabelText("Selecionar todas as notas desta página"));
  expect(screen.getByLabelText("Selecionar nota 101")).toBeChecked();
  rerender(<NotasList {...props} filters={{ ...props.filters, competencia: "2026-09" }} onBaixarSelecionadas={baixar} />);
  expect(screen.getByLabelText("Selecionar nota 101")).not.toBeChecked();
  expect(screen.queryByRole("button", { name: "Baixar XML" })).not.toBeInTheDocument();
});
it("expõe falhas parciais do lote", async () => {
  render(<NotasList {...props} onBaixarSelecionadas={async () => ({ blob: new Blob(["zip"]), geradas: 1, falhas: 1 })} />);
  fireEvent.click(screen.getByLabelText("Selecionar todas as notas desta página"));
  fireEvent.click(screen.getByRole("button", { name: "Baixar XML" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("1 indisponível");
});
it("só esconde emitidas quando todas as atividades são serviços conhecidos e não há IE", () => {
  const servico = { tipoReceita: "SERVICO_FATOR_R" };
  expect(somenteServicosSemIE(null, { candidatos: [servico] })).toBe(true);
  for (const [ie, candidatos] of [["123", [servico]], [undefined, [servico]], [null, []], [null, [servico, { tipoReceita: "REVENDA_MERCADORIA" }]], [null, [{ ...servico, ambiguo: true }]]]) {
    expect(somenteServicosSemIE(ie, { candidatos })).toBe(false);
  }
  render(<NotasList {...props} somenteRecebidas />);
  expect(screen.queryByRole("option", { name: "Emitidas" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Recebidas" })).toBeInTheDocument();
});


it('sem seleção não oferece downloads nem cancelamento fiscal em lote', () => {
  render(<NotasList {...props} onBaixarSelecionadas={jest.fn()} />);
  expect(screen.queryByRole('button', { name: /^(Baixar XML|Baixar DANFE \/ DANFSe|Cancelar)$/ })).not.toBeInTheDocument();
});
it('seleção tem teto de 100, limpa por página e filtros de data/situação', () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ ...notas[0], id: String(i), numero: String(1000 + i) }));
  const view = render(<NotasList {...props} notas={many} onBaixarSelecionadas={jest.fn()} />);
  fireEvent.click(screen.getByLabelText('Selecionar todas as notas desta página'));
  expect(screen.getByLabelText('Selecionar nota 1100')).not.toBeChecked();
  expect(screen.getByLabelText('Selecionar nota 1100')).toBeDisabled();
  for (const patch of [{ offset: 100 }, { dataInicio: '2026-08-01' }, { situacao: 'cancelada' }]) {
    view.rerender(<NotasList {...props} notas={many} filters={{ ...props.filters, ...patch }} onBaixarSelecionadas={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Baixar XML' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Selecionar nota 1000'));
  }
});

it('download atrasado após troca de filtros não dispara arquivo no contexto novo', async () => {
  let resolve;
  const baixar = jest.fn(() => new Promise(r => { resolve = r; }));
  const view = render(<NotasList {...props} onBaixarSelecionadas={baixar} />);
  fireEvent.click(screen.getByLabelText('Selecionar nota 101'));
  fireEvent.click(screen.getByRole('button', { name: 'Baixar XML' }));
  view.rerender(<NotasList {...props} filters={{ ...props.filters, offset: 100 }} onBaixarSelecionadas={baixar} />);
  resolve({ blob: new Blob(['zip']), geradas: 1, falhas: 0 });
  await waitFor(() => expect(screen.queryByText('Preparando arquivos…')).not.toBeInTheDocument());
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
