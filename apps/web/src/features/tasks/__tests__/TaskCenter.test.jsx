import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TaskCenter } from "../TaskCenter";
import { useBackgroundJobs } from "../../companies/list/hooks/useBackgroundJobs";
import { renderHook } from "@testing-library/react";

test("lista múltiplas tarefas sem modal e conserva resultados após navegação", async () => {
  const jobs = [{ jobId: "a", tipo: "notas", total: 3, processadas: 1, status: "processando" }];
  const local = [{ jobId: "send-a", tipo: "envio-guias", status: "running", companyName: "Empresa A", total: 2, processadas: 0 }];
  const ui = props => <MemoryRouter><TaskCenter api={{}} background={{ tarefas: jobs }} {...props} /></MemoryRouter>;
  const { rerender } = render(ui({ localTasks: local }));
  fireEvent.click(screen.getByRole("button", { name: /Tarefas \(2\)/ }));
  expect(screen.getByText("Download de notas")).toBeInTheDocument(); expect(screen.getByText("Empresa A")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(ui({ localTasks: [{ ...local[0], status: "partial", processadas: 2, result: { resultados: [{ rotulo: "INSS", texto: "Confira a entrega." }] } }] }));
  expect(screen.getByText("Confira a entrega.")).toBeInTheDocument();
  rerender(ui({ localTasks: [] }));
  expect(screen.getByText("Empresa A")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Lista de tarefas" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Tarefas \(1\)/ })).toHaveFocus();
});

test("falha de monitoramento conserva tarefas e não repete ações; resposta de sessão antiga é descartada", async () => {
  const api = { getJobsAtivos: jest.fn().mockResolvedValueOnce({ jobs: [{ jobId: "a", status: "running" }] }).mockRejectedValueOnce(new Error("offline")) };
  const { result, rerender } = renderHook(props => useBackgroundJobs({ api, ...props }), { initialProps: { enabled: true, sessionKey: "a" } });
  await waitFor(() => expect(result.current.total).toBe(1));
  await act(async () => result.current.refresh());
  expect(result.current.total).toBe(1); expect(result.current.error).toContain("preservado");
  let finish; api.getJobsAtivos.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending; act(() => { pending = result.current.refresh(); });
  rerender({ enabled: false, sessionKey: "b" });
  await act(async () => { finish({ jobs: [{ jobId: "private-a" }] }); await pending; });
  expect(result.current.tarefas).toEqual([]);
});

test("resultado oferece arquivo salvo e atalho correto sem iniciar nova consulta", async () => {
  const api = { fetchSitfisDownloadBlob: jest.fn(async () => new Blob(["zip"])), getBackgroundTask: jest.fn() };
  const previous = URL.createObjectURL;
  URL.createObjectURL = jest.fn(() => "blob:teste");
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    render(<MemoryRouter><TaskCenter api={api} background={{ tarefas: [{ jobId: "zip-1", tipo: "sitfis", companyIds: ["c1"], status: "concluido", arquivoDisponivel: true }] }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Tarefas/ }));
    expect(screen.getByRole("link", { name: "Abrir empresa" })).toHaveAttribute("href", "/companies/c1/sitfis");
    fireEvent.click(screen.getByRole("button", { name: "Baixar arquivo" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.fetchSitfisDownloadBlob).toHaveBeenCalledWith("zip-1"); expect(api.getBackgroundTask).not.toHaveBeenCalled();
  } finally { URL.createObjectURL = previous; click.mockRestore(); }
});
