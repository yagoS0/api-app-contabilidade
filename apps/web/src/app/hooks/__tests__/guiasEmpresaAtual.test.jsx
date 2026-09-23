import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../useManageCompaniesWorkspace";

const pendente = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
};
const guia = (company, changes = {}) => ({ guideId: `guia-${company}`, tipo: "SIMPLES", competencia: "2026-05", canRecalculate: true, paymentStatus: "OPEN", ...changes });
function montar({ getCompanyGuides, recalculateGuide, syncSerproInss, apiExtras = {}, home = false } = {}) {
  const api = {
    listCompanies: jest.fn().mockResolvedValue([{ companyId: "A" }, { companyId: "B" }]),
    getCompanyGuides: getCompanyGuides || jest.fn(async (company) => [guia(company)]),
    getSerproSettings: jest.fn().mockResolvedValue({}), getSerproStatus: jest.fn().mockResolvedValue({}),
    recalculateGuide: recalculateGuide || jest.fn().mockResolvedValue({ emailDispatch: { sent: 1 } }),
    syncSerproInss: syncSerproInss || jest.fn().mockResolvedValue({}),
  };
  Object.assign(api, apiExtras);
  const feedback = { clearFeedback: jest.fn(), setError: jest.fn(), setMessage: jest.fn() };
  const wrapper = ({ children }) => <MemoryRouter initialEntries={[home ? "/" : "/companies/A/sitfis"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>;
  const hook = renderHook(({ page }) => ({
    workspace: useManageCompaniesWorkspace({ api, page, setPage: jest.fn(), feedback }),
    navigate: useNavigate(),
  }), { wrapper, initialProps: { page: home ? "companies" : "companyDetail" } });
  return { ...hook, api, feedback };
}

it("resposta tardia de A não aparece em B nem termina o carregamento de B", async () => {
  const a = pendente(), b = pendente();
  const getCompanyGuides = jest.fn((company) => company === "A" ? a.promise : b.promise);
  const { result } = montar({ getCompanyGuides });
  await waitFor(() => expect(getCompanyGuides).toHaveBeenCalledWith("A"));
  act(() => result.current.navigate("/companies/B/sitfis"));
  await waitFor(() => expect(getCompanyGuides).toHaveBeenCalledWith("B"));
  await act(async () => a.resolve([guia("A")]));
  expect(result.current.workspace.guidesState.guides).toEqual([]);
  expect(result.current.workspace.guidesState.loadingGuides).toBe(true);
  await act(async () => b.resolve([guia("B")]));
  expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]);
  expect(result.current.workspace.guidesState.loadingGuides).toBe(false);
});

it("falha tardia da consulta A não apaga guias nem mostra erro em B", async () => {
  const a = pendente();
  const { result, feedback } = montar({ getCompanyGuides: jest.fn((company) => company === "A" ? a.promise : Promise.resolve([guia("B")])) });
  act(() => result.current.navigate("/companies/B/sitfis"));
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]));
  feedback.setError.mockClear();
  await act(async () => a.reject(new Error("Erro da empresa A")));
  expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]);
  expect(feedback.setError).not.toHaveBeenCalled();
});

it("callback antigo e ID de A são recusados em B; o recálculo válido bloqueia dupla execução", async () => {
  const job = pendente();
  const { result, api } = montar({ recalculateGuide: jest.fn(() => job.promise) });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("A")]));
  const antigo = result.current.workspace.handleRecalculateGuide;
  act(() => result.current.navigate("/companies/B/sitfis"));
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]));
  await act(async () => {
    await antigo("guia-A");
    await result.current.workspace.handleRecalculateGuide("guia-A");
  });
  expect(api.recalculateGuide).not.toHaveBeenCalled();
  let trabalho;
  act(() => {
    trabalho = result.current.workspace.handleRecalculateGuide("guia-B");
    result.current.workspace.handleRecalculateGuide("guia-B");
  });
  expect(api.recalculateGuide).toHaveBeenCalledTimes(1);
  expect(api.recalculateGuide).toHaveBeenCalledWith("guia-B");
  await act(async () => { job.resolve({ emailDispatch: { sent: 1 } }); await trabalho; });
});

it("recálculo iniciado em A não publica desfecho nem recarrega A após navegar para B", async () => {
  const job = pendente();
  const { result, api, feedback } = montar({ recalculateGuide: jest.fn(() => job.promise) });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("A")]));
  let trabalho;
  act(() => { trabalho = result.current.workspace.handleRecalculateGuide("guia-A"); });
  act(() => result.current.navigate("/companies/B/sitfis"));
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]));
  api.getCompanyGuides.mockClear(); feedback.setMessage.mockClear(); feedback.setError.mockClear();
  await act(async () => { job.resolve({ emailDispatch: { sent: 1 } }); await trabalho; });
  expect(api.getCompanyGuides).not.toHaveBeenCalled();
  expect(feedback.setMessage).not.toHaveBeenCalled();
  expect(feedback.setError).not.toHaveBeenCalled();
  expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]);
});

it("INSS mantém a empresa do callback e bloqueia chamadas repetidas", async () => {
  const job = pendente();
  const getCompanyGuides = jest.fn(async (company) => [guia(company, { tipo: "INSS", canRecalculate: false })]);
  const { result, api, feedback } = montar({ getCompanyGuides, syncSerproInss: jest.fn(() => job.promise) });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  const antigo = result.current.workspace.handleRecalcularInss;
  act(() => result.current.navigate("/companies/B/sitfis"));
  await waitFor(() => expect(result.current.workspace.guidesState.guides[0]?.guideId).toBe("guia-B"));
  await act(async () => antigo("2026-05"));
  expect(api.syncSerproInss).not.toHaveBeenCalled();
  let trabalho;
  act(() => {
    trabalho = result.current.workspace.handleRecalcularInss("2026-05");
    result.current.workspace.handleRecalcularInss("2026-05");
  });
  expect(api.syncSerproInss).toHaveBeenCalledTimes(1);
  expect(api.syncSerproInss).toHaveBeenCalledWith("B", { competencia: "2026-05", atualizar: true });
  await act(async () => { job.resolve({ ok: true, result: { guide: { guideId: "guia-B" }, inss: { status: "EMITTED" } } }); await trabalho; });
  expect(feedback.setMessage).toHaveBeenCalledWith("INSS de 2026-05 recalculado/atualizado.");
});

it.each([
  ["não transmitida", { result: { inss: { status: "NOT_TRANSMITTED" } } }],
  ["não encontrada", { result: { inss: { status: "NOT_FOUND" } } }],
  ["emitida sem guia", { result: { inss: { status: "EMITTED" } } }],
  ["guia reaproveitada", { result: { guide: { guideId: "guia-A" }, inss: { status: "REUSED" } } }],
  ["resposta vazia", undefined],
])("INSS %s não é apresentado como recálculo confirmado", async (_caso, payload) => {
  const getCompanyGuides = jest.fn(async (company) => [guia(company, { tipo: "INSS", canRecalculate: false })]);
  const { result, feedback } = montar({ getCompanyGuides, syncSerproInss: jest.fn().mockResolvedValue(payload) });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  getCompanyGuides.mockClear();
  await act(async () => result.current.workspace.handleRecalcularInss("2026-05"));
  expect(getCompanyGuides).toHaveBeenCalledWith("A");
  expect(feedback.setError).toHaveBeenCalledWith(expect.stringContaining("Não houve confirmação de recálculo"));
  expect(feedback.setMessage).not.toHaveBeenCalled();
  expect(result.current.workspace.recalcInssBusy).toBe(false);
});

it("loadGuides continua funcionando na home para a empresa selecionada", async () => {
  const { result, api } = montar({ home: true });
  await waitFor(() => expect(result.current.workspace.companiesState.selectedCompanyId).toBe("A"));
  await act(async () => result.current.workspace.loadGuides("A"));
  expect(api.getCompanyGuides).toHaveBeenCalledWith("A");
  expect(result.current.workspace.guidesState.guides).toEqual([guia("A")]);
  expect(result.current.workspace.guidesState.loadingGuides).toBe(false);
});

it.each(['handleResendGuide', 'handleLiberarGuia', 'handleLiberarGuias'])('envio tardio %s não publica aviso em outra aba', async nome => {
  const job = pendente();
  const { result, api, feedback } = montar({ apiExtras: {
    listarContatosWhatsapp: jest.fn().mockResolvedValue({ canalPadraoEnvio: 'EMAIL' }),
    resendGuideEmail: jest.fn(() => job.promise), liberarGuiaCliente: jest.fn(() => job.promise),
  } });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  let trabalho;
  act(() => { trabalho = result.current.workspace[nome](nome === 'handleLiberarGuias' ? [{ guideId: 'guia-A', rotulo: 'DAS' }] : 'guia-A'); });
  await waitFor(() => expect(api.listarContatosWhatsapp).toHaveBeenCalled());
  act(() => result.current.navigate('/companies/A/notas-fiscais'));
  feedback.setMessage.mockClear(); feedback.setError.mockClear(); api.getCompanyGuides.mockClear();
  await act(async () => { job.resolve({ sent: true }); await trabalho; });
  expect(feedback.setMessage).not.toHaveBeenCalled(); expect(feedback.setError).not.toHaveBeenCalled();
  expect(api.getCompanyGuides).not.toHaveBeenCalled();
});

it('INSS tardio não publica aviso em outra aba da mesma empresa', async () => {
  const job = pendente();
  const { result, feedback } = montar({ getCompanyGuides: jest.fn(async company => [guia(company, { tipo: 'INSS' })]), syncSerproInss: jest.fn(() => job.promise) });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toHaveLength(1));
  let trabalho;
  act(() => { trabalho = result.current.workspace.handleRecalcularInss('2026-05'); });
  act(() => result.current.navigate('/companies/A/notas-fiscais'));
  feedback.setError.mockClear(); feedback.setMessage.mockClear();
  await act(async () => { job.resolve({}); await trabalho; });
  expect(feedback.setError).not.toHaveBeenCalled(); expect(feedback.setMessage).not.toHaveBeenCalled();
});


describe("configuração SERPRO", () => {
  it("carrega ao abrir Consultas diretamente e separa carga de ausência", async () => {
    const resposta = pendente();
    const { result, rerender, api } = montar({ apiExtras: { getSerproSettings: jest.fn(() => resposta.promise) } });
    rerender({ page: "serproFuncoes" });
    await waitFor(() => expect(api.getSerproSettings).toHaveBeenCalledTimes(1));
    expect(result.current.workspace.serproSettingsStatus).toBe("loading");
    expect(result.current.workspace.guideSettings).toBeNull();
    await act(async () => resposta.resolve({ enabled: true, certificate: { hasCertificate: true } }));
    expect(result.current.workspace.serproSettingsStatus).toBe("ready");
    expect(result.current.workspace.guideSettings.enabled).toBe(true);
  });
  it("falha de atualização preserva configuração anterior e permite tentar novamente", async () => {
    const settings = { enabled: true, certificate: { hasCertificate: true } };
    const getSerproSettings = jest.fn().mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error("indisponível")).mockResolvedValueOnce(settings);
    const { result, rerender } = montar({ apiExtras: { getSerproSettings } });
    rerender({ page: "serproFuncoes" });
    await waitFor(() => expect(result.current.workspace.serproSettingsStatus).toBe("ready"));
    await act(async () => result.current.workspace.loadGuideSettings());
    expect(result.current.workspace.serproSettingsStatus).toBe("error");
    expect(result.current.workspace.guideSettings).toEqual(settings);
    await act(async () => result.current.workspace.loadGuideSettings());
    expect(result.current.workspace.serproSettingsStatus).toBe("ready");
  });
  it("resposta antiga não substitui a configuração mais recente", async () => {
    const antigo = pendente();
    const { result, rerender } = montar({ apiExtras: { getSerproSettings: jest.fn().mockReturnValueOnce(antigo.promise).mockResolvedValueOnce({ enabled: true }) } });
    rerender({ page: "serproFuncoes" });
    await waitFor(() => expect(result.current.workspace.serproSettingsStatus).toBe("loading"));
    await act(async () => result.current.workspace.loadGuideSettings());
    await act(async () => antigo.resolve({ enabled: false }));
    expect(result.current.workspace.guideSettings.enabled).toBe(true);
  });
  it("consulta guia usa competência fiscal, não força atualização e bloqueia chamada duplicada", async () => {
    const job = pendente();
    const captureSerproPgdasd = jest.fn(() => job.promise);
    const { result } = montar({ apiExtras: { captureSerproPgdasd } });
    await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("A")]));
    let consulta;
    act(() => {
      consulta = result.current.workspace.handleBuscarGuiaSerpro("das", "A", "2026-07");
      result.current.workspace.handleBuscarGuiaSerpro("das", "A", "2026-07");
    });
    expect(captureSerproPgdasd).toHaveBeenCalledTimes(1);
    expect(captureSerproPgdasd).toHaveBeenCalledWith("A", { competencia: "2026-07" });
    await act(async () => { job.resolve({ result: {} }); await consulta; });
  });
});

it("consulta INSS normal preserva payload e ignora retorno em outra empresa", async () => {
  const job = pendente();
  const { result, api, feedback } = montar({ syncSerproInss: jest.fn(() => job.promise) });
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("A")]));
  let consulta;
  act(() => { consulta = result.current.workspace.handleBuscarGuiaSerpro("inss", "A", "2026-07"); });
  expect(api.syncSerproInss).toHaveBeenCalledWith("A", { competencia: "2026-07" });
  act(() => result.current.navigate("/companies/B/sitfis"));
  await waitFor(() => expect(result.current.workspace.guidesState.guides).toEqual([guia("B")]));
  feedback.setMessage.mockClear();
  api.getCompanyGuides.mockClear();
  await act(async () => { job.resolve({ result: {} }); await consulta; });
  expect(api.getCompanyGuides).not.toHaveBeenCalled();
  expect(feedback.setMessage).not.toHaveBeenCalled();
});
