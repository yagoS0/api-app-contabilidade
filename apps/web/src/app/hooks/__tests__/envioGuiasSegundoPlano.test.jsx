import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../useManageCompaniesWorkspace";

function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
function montar() {
  const api = {
    listCompanies: jest.fn().mockResolvedValue([{ companyId: "A", razao: "Empresa A" }, { companyId: "B", razao: "Empresa B" }]),
    getCompanyGuides: jest.fn(async id => [{ id: `guia-${id}`, status: "PROCESSED" }]),
    listarContatosWhatsapp: jest.fn().mockResolvedValue({ canalPadraoEnvio: "EMAIL" }),
    liberarGuiaCliente: jest.fn().mockResolvedValue({ sent: true }),
    resendGuideEmail: jest.fn().mockResolvedValue({ sent: true }),
  };
  const feedback = { clearFeedback: jest.fn(), setMessage: jest.fn(), setError: jest.fn() };
  const wrapper = ({ children }) => <MemoryRouter initialEntries={["/companies/A/guides"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>;
  const hook = renderHook(() => ({ workspace: useManageCompaniesWorkspace({ api, feedback, page: "companyDetail", setPage: jest.fn() }), navigate: useNavigate() }), { wrapper });
  return { ...hook, api, feedback };
}

test("envio e releitura não escondem a tabela; clique repetido não envia novamente", async () => {
  const { result, api, feedback } = montar();
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  const envio = deferred(), leitura = deferred();
  api.liberarGuiaCliente.mockReturnValueOnce(envio.promise);
  api.getCompanyGuides.mockReturnValueOnce(leitura.promise);
  let job;
  act(() => { job = result.current.workspace.handleLiberarGuia("guia-A"); result.current.workspace.handleLiberarGuias([{ guideId: "guia-A" }]); });
  await waitFor(() => expect(api.liberarGuiaCliente).toHaveBeenCalledTimes(1));
  expect(result.current.workspace.envioGuiasProgresso).toMatchObject({ status: "running", completed: 0, total: 1 });
  expect(result.current.workspace.guidesState.loadingGuides).toBe(false);
  await act(async () => envio.resolve({ sent: true }));
  expect(result.current.workspace.guidesState.guides[0].id).toBe("guia-A");
  expect(result.current.workspace.guidesState.loadingGuides).toBe(false);
  await act(async () => { leitura.resolve([{ id: "guia-A", emailStatus: "SENT" }]); await job; });
  expect(result.current.workspace.envioGuiasProgresso.status).toBe("done");
  feedback.clearFeedback.mockClear();
  api.getCompanyGuides.mockRejectedValueOnce(new Error("rede indisponível"));
  await act(async () => result.current.workspace.loadGuides("A", { background: true }));
  expect(result.current.workspace.guidesState.guides[0].emailStatus).toBe("SENT");
  expect(feedback.clearFeedback).not.toHaveBeenCalled();
  expect(result.current.workspace.envioGuiasProgresso.status).toBe("done");
});

test("progresso parcial e resultado ficam na empresa de origem após navegar", async () => {
  const { result, api, feedback } = montar();
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  const segundo = deferred();
  api.liberarGuiaCliente.mockResolvedValueOnce({ sent: true }).mockReturnValueOnce(segundo.promise);
  let job;
  act(() => { job = result.current.workspace.handleLiberarGuias([{ guideId: "g1", rotulo: "DAS" }, { guideId: "g2", rotulo: "INSS" }]); });
  await waitFor(() => expect(result.current.workspace.envioGuiasProgresso.completed).toBe(1));
  act(() => result.current.navigate("/companies/B/guides"));
  await waitFor(() => expect(result.current.workspace.guidesState.guides[0].id).toBe("guia-B"));
  feedback.setError.mockClear();
  await act(async () => { segundo.reject(Object.assign(new Error("PDF indisponível"), { status: 422 })); await job; });
  expect(result.current.workspace.envioGuiasProgresso).toMatchObject({ companyId: "A", companyName: "Empresa A", status: "error", completed: 2, total: 2 });
  expect(result.current.workspace.envioGuiasProgresso.resultados.map(r => r.ok)).toEqual([true, false]);
  expect(result.current.workspace.guidesState.guides[0].id).toBe("guia-B");
  expect(feedback.setError).not.toHaveBeenCalled();
  expect(api.liberarGuiaCliente).toHaveBeenCalledTimes(2);
});

test("falha da releitura não apaga o resultado de envio nem repete chamadas", async () => {
  const { result, api } = montar();
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  api.getCompanyGuides.mockRejectedValueOnce(new Error("rede indisponível"));
  await act(async () => result.current.workspace.handleLiberarGuia("guia-A"));
  expect(result.current.workspace.envioGuiasProgresso).toMatchObject({ status: "done", completed: 1, refreshError: expect.stringContaining("resultado do envio foi preservado") });
  expect(result.current.workspace.guidesState.guides).toHaveLength(1);
  expect(api.liberarGuiaCliente).toHaveBeenCalledTimes(1);
});
