import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ImportacaoNotasModal } from "../ImportacaoNotasModal";
import { useNotasFiscais } from "../../hooks/useNotasFiscais";

test("modal trava saídas durante o processamento e mantém o resultado ao concluir", () => {
  const aoFechar = jest.fn();
  const andamento = { empresa: "Empresa A", type: "NFE", temZip: true, progresso: { etapa: "processando", loteAtual: 2, totalLotes: 3, lotesConcluidos: 1, totalArquivos: 45, arquivosConcluidos: 20, totais: { novas: 19 } } };
  const { rerender } = render(<ImportacaoNotasModal andamento={andamento} ocupado aoFechar={aoFechar} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
  expect(screen.getByText(/lote 2 de 3/)).toBeInTheDocument();
  expect(screen.getByText(/Cada ZIP conta como um arquivo/)).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("dialog"));
  expect(aoFechar).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Concluir" })).not.toBeInTheDocument();
  rerender(<ImportacaoNotasModal andamento={andamento} resultado={{ mensagem: "19 novas e uma recusada.", quantidadeProblemas: 1, problemas: [{ arquivo: "errada.xml", mensagem: "Outra empresa." }] }} ocupado={false} aoFechar={aoFechar} />);
  expect(screen.getByRole("alert")).toHaveTextContent("19 novas");
  fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
  expect(aoFechar).toHaveBeenCalledTimes(1);
});

test("trava imediata evita envio duplo e conserva a empresa original se a navegação mudar", async () => {
  let concluir;
  const api = { mode: "real", listNotas: jest.fn(async () => ({ notas: [], total: 0 })), importInvoicesXml: jest.fn(() => new Promise(resolve => { concluir = resolve; })) };
  const { result, rerender } = renderHook(props => useNotasFiscais({ ...props, api }), { initialProps: { companyId: "a", companyName: "Empresa A" } });
  await waitFor(() => expect(result.current.loadingNotas).toBe(false));
  let tarefa;
  act(() => { tarefa = result.current.importNotas([new File(["a"], "nota.xml")], { type: "NFE" }); result.current.importNotas([new File(["b"], "outra.xml")]); });
  expect(api.importInvoicesXml).toHaveBeenCalledTimes(1);
  act(() => result.current.fecharImportModal());
  expect(result.current.importModalAberto).toBe(true);
  const antes = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(antes);
  expect(antes.defaultPrevented).toBe(true);
  rerender({ companyId: "b", companyName: "Empresa B" });
  await act(async () => { concluir({ ok: true, importadas: 1 }); await tarefa; });
  expect(result.current.importAndamento.empresa).toBe("Empresa A");
  expect(result.current.importModalResultado.companyId).toBe("a");
  expect(result.current.importResult).toBeNull();
  const depois = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(depois);
  expect(depois.defaultPrevented).toBe(false);
  act(() => result.current.fecharImportModal());
  expect(result.current.importModalAberto).toBe(false);
});
