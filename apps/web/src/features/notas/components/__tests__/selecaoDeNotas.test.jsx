import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotasList } from "../NotasList";
import { somenteServicosSemIE } from "../../lib/janelasDeNotas";
const notas = [{ id: "1", numero: "101", type: "NFSE", papel: "DEST" }, { id: "2", numero: "102", type: "NFSE", papel: "DEST" }];
const props = { notas, total: 2, filters: { competencia: "2026-08", papel: "DEST" }, onFiltersChange: jest.fn(), onApply: jest.fn(), onAbrirNota: jest.fn() };
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
  expect(screen.getByRole("button", { name: "Baixar XML" })).toBeDisabled();
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
