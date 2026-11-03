import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../useManageCompaniesWorkspace";
function montar(result) {
  const api = { listCompanies: jest.fn(async () => []), getCompanyGuides: jest.fn(async () => []), getSerproSettings: jest.fn(async () => ({})), getSerproStatus: jest.fn(async () => ({})), syncPgdasCircular: jest.fn(async () => ({ ok: true, result })) };
  const feedback = { clearFeedback: jest.fn(), setError: jest.fn(), setMessage: jest.fn() };
  const wrapper = ({ children }) => <MemoryRouter initialEntries={["/companies/c/lancamentos"]}>{children}</MemoryRouter>;
  const hook = renderHook(() => useManageCompaniesWorkspace({ api, page: "companyDetail", setPage: jest.fn(), feedback }), { wrapper });
  return { ...hook, api, feedback };
}
test.each([
  [{ circular: { serproSyncStatus: "INCOMPLETE" } }, /incompleto/],
  [{ circular: { serproSyncStatus: "SUCCESS" }, accounting: { ok: false, reason: "extrato_incompleto" } }, /pendente/],
  [{ circular: { serproSyncStatus: "SUCCESS" }, accounting: { ok: true, divergences: [{}] } }, /pendente/],
  [{ circular: { serproSyncStatus: "SUCCESS" }, accounting: { ok: true, skipped: [{}] } }, /pendente/],
])("feedback não anuncia lançamentos concluídos com pendência %j", async (payload, message) => {
  const t = montar(payload);
  await act(async () => { await t.result.current.handleSyncSerproPgdas("c", { competencia: "2026-09" }); });
  expect(t.feedback.setError).toHaveBeenCalledWith(expect.stringMatching(message));
  expect(t.feedback.setMessage).not.toHaveBeenCalled();
});
test("reaproveitamento distingue criados e ja existentes e envia intenção explícita", async () => {
  const t = montar({ reutilizado: true, circular: { serproSyncStatus: "SUCCESS" }, accounting: { ok: true, generatedEntries: [{ action: "created" }, { action: "noop" }] } });
  await act(async () => { await t.result.current.handleSyncSerproPgdas("c", { competencia: "2026-09", atualizar: true }); });
  expect(t.api.syncPgdasCircular).toHaveBeenCalledWith("c", "2026-09", expect.objectContaining({ atualizar: true }));
  expect(t.feedback.setMessage).toHaveBeenCalledWith(expect.stringMatching(/reaproveitado.*1 criados; 1 já existentes/));
});

test.each([
  [{ ok: false }, false],
  [undefined, true],
  [new Error("Transporte interrompido"), true],
])("Presumido conserva tentativa enviada e distingue resultado incerto: %j", async (payload, resultadoIncerto) => {
  const t = montar(null);
  t.api.captureSerproLp = jest.fn(async () => {
    if (payload instanceof Error) throw payload;
    return payload;
  });
  let resposta;
  await act(async () => { resposta = await t.result.current.handleCaptureSerproLp("c", { competencia: "2026-09" }); });
  expect(resposta).toMatchObject({ ok: false, tentativaEnviada: true, resultadoIncerto });
  expect(t.api.captureSerproLp).toHaveBeenCalledTimes(1);
  if (resultadoIncerto) expect(t.feedback.setMessage).not.toHaveBeenCalled();
});

test("Presumido sem competência não registra tentativa externa", async () => {
  const t = montar(null);
  t.api.captureSerproLp = jest.fn();
  let resposta;
  await act(async () => { resposta = await t.result.current.handleCaptureSerproLp("c", {}); });
  expect(resposta).toMatchObject({ ok: false, tentativaEnviada: false });
  expect(t.api.captureSerproLp).not.toHaveBeenCalled();
});

test.each(["handleSyncSerproPgdas", "handleCaptureSerproLp"])("%s publica feedback depois da recarga e descarta outra competência", async method => {
  let resolver; let competencia="2026-09"; const eventos=[];
  const resposta={ok:true,result:{circular:{serproSyncStatus:"SUCCESS"},accounting:{ok:true,generatedEntries:[]},debitos:[]}};
  const chamada=()=>new Promise(r=>{resolver=r;});
  const api={listCompanies:async()=>[],getCompanyGuides:async()=>[],getSerproSettings:async()=>({}),syncPgdasCircular:chamada,captureSerproLp:chamada};
  const feedback={clearFeedback:()=>eventos.push("clear"),setError:()=>eventos.push("error"),setMessage:()=>eventos.push("message")};
  const refresh=jest.fn(async()=>{feedback.clearFeedback();});
  const {result}=renderHook(()=>useManageCompaniesWorkspace({api,feedback,page:"companyDetail",setPage:jest.fn(),onPgdasSynced:refresh,getCompetenciaAtual:()=>competencia}),{wrapper:({children})=><MemoryRouter initialEntries={["/companies/c/lancamentos"]}>{children}</MemoryRouter>});
  let pending; act(()=>{pending=result.current[method]("c",{competencia});});
  await act(async()=>{resolver(resposta);await pending;});
  expect(eventos.at(-1)).toBe("message"); expect(refresh).toHaveBeenCalledTimes(1);
  act(()=>{pending=result.current[method]("c",{competencia});}); competencia="2026-10";
  const anterior=[...eventos]; await act(async()=>{resolver(resposta);await pending;});
  expect(eventos).toEqual(anterior); expect(refresh).toHaveBeenCalledTimes(1);
});
