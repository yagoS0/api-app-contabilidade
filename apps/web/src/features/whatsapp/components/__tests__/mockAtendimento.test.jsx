import { createMockApi } from "../../../../api/mock/mockApi";
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, "", "/"); });
afterEach(() => { jest.useRealTimers(); });
test("rascunho mock sobrevive ao link que recarrega a página", async () => {
  jest.useFakeTimers();
  const api = createMockApi();
  const criacao = api.criarOnboarding("ABERTURA"); await jest.runAllTimersAsync(); const { onboarding } = await criacao;
  const salvar = api.salvarOnboarding(onboarding.id, { dados: { responsavelNome: "Carlos", responsavelTelefone: "+5511977776666" } });
  await jest.runAllTimersAsync(); await salvar;
  jest.resetModules();
  const aposReload = require("../../../../api/mock/mockApi").createMockApi();
  const leitura = aposReload.getOnboarding(onboarding.id); await jest.runAllTimersAsync();
  expect((await leitura).onboarding.dados.responsavelNome).toBe("Carlos");
});
test("falha do resumo mock é erro, e leitura de fio diminui o contador", async () => {
  jest.useFakeTimers(); const api = createMockApi();
  const antesPromise = api.getResumoWhatsapp(); await jest.runAllTimersAsync(); const antes = await antesPromise;
  const fio = api.getMensagensWhatsapp("mock-cv-3"); await jest.runAllTimersAsync(); await fio;
  const depoisPromise = api.getResumoWhatsapp(); await jest.runAllTimersAsync(); const depois = await depoisPromise;
  expect(depois.resumo.mensagensNaoLidas).toBeLessThan(antes.resumo.mensagensNaoLidas);
  localStorage.setItem("mock:whatsapp:falhaResumo", "1");
  const falha = expect(api.getResumoWhatsapp()).rejects.toThrow("Não foi possível ler"); await jest.runAllTimersAsync(); await falha;
});
