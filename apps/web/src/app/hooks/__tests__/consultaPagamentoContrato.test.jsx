import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useManageCompaniesWorkspace } from "../useManageCompaniesWorkspace";
import { resultadoContabil } from "../../../features/fiscal/serpro/lib/consultaResultado";

test.each([{ok:true}, {ok:true, generatedEntries:{}}, {ok:true,generatedEntries:[null]}, {ok:true,generatedEntries:[],skipped:{}}, {ok:true,generatedEntries:[],divergences:"erro"}])("contrato contábil inválido não fabrica sucesso %j", value => {
  expect(resultadoContabil(value).ok).toBe(false);
});

test.each([
  ["parcelamento", {ok:true,parcelamentos:[],skipped:"sem_parcelamento_ativo"}, true],
  ["parcelamento", {ok:true,parcelamentos:[{id:"p",parcelas:[],reason:"sem_parcelas_disponiveis"}]}, true],
  ["parcelamento", {ok:true,parcelamentos:[{id:"p",parcelas:[{status:"erro"}]}]}, false],
  ["parcelamento", {ok:true,parcelamentos:[{id:"p",parcelas:[{status:"conferir_documento"}]}]}, false],
  ["parcelamento", {ok:true,result:{}}, false],
  ["das", {ok:true,result:{}}, false],
  ["das", {ok:true,result:{guide:{guideId:"g",status:"PROCESSED"}}}, true],
  ["inss", {ok:true,result:{}}, false],
  ["inss", {ok:true,result:{inss:{status:"NOT_TRANSMITTED"}}}, false],
  ["inss", {ok:true,result:{inss:{status:"EMITTED"},accounting:{ok:true,generatedEntries:[]}}}, true],
  ["pagamento", {ok:true,result:{total:1,paid:2,errors:0}}, false],
  ["pagamento", {ok:true,result:{total:2,paid:1,errors:1}}, false],
  ["pagamento", undefined, false],
])("%s respeita contrato real %j", async (op, resposta, ok) => {
  const chamada = jest.fn(async () => resposta);
  const api = {listCompanies:async()=>[],getCompanyGuides:async()=>[],getSerproSettings:async()=>({}),captureSerproParcelamento:chamada,captureSerproPgdasd:chamada,syncSerproInss:chamada,confirmarPagamentoSerpro:chamada};
  const feedback = {clearFeedback:jest.fn(),setError:jest.fn(),setMessage:jest.fn()};
  const {result} = renderHook(()=>useManageCompaniesWorkspace({api,feedback,page:"companyDetail",setPage:jest.fn()}), {wrapper:({children})=><MemoryRouter>{children}</MemoryRouter>});
  let out; await act(async()=>{out=await result.current.runSerproOp(op,"c","2026-09");});
  expect(out.ok).toBe(ok); expect(chamada).toHaveBeenCalledTimes(1);
});


test("resumo distingue criados, atualizados e existentes sem chamar tudo de criado", () => {
 const r = resultadoContabil({ok:true,generatedEntries:[{action:"created"},{action:"updated"},{action:"recalculated"},{action:"noop"}]});
 expect(r.ok).toBe(true);
 expect(r.message).toMatch(/1 criados; 2 atualizados; 1 já existentes/);
});


test.each([
 [null, false],
 [{alerta:false,reconciliacao:{PIS:{status:"sem_dctfweb"},COFINS:{status:"sem_dctfweb"}}},false],
 [{alerta:false,reconciliacao:{}},false],
 [{alerta:true,reconciliacao:{PIS:{status:"divergente"},COFINS:{status:"ok"}}},false],
 [{alerta:false,reconciliacao:{PIS:{status:"ok"},COFINS:{status:"ok"}}},true],
])("Presumido só confirma reconciliação com itens confirmados: %j", async (reconciliacao,ok)=>{
 const api={listCompanies:async()=>[],getCompanyGuides:async()=>[],getSerproSettings:async()=>({}),captureSerproLp:async()=>({ok:true,result:{debitos:[],reconciliacao}})};
 const feedback={clearFeedback:jest.fn(),setError:jest.fn(),setMessage:jest.fn()};
 const {result}=renderHook(()=>useManageCompaniesWorkspace({api,feedback,page:"companyDetail",setPage:jest.fn()}),{wrapper:({children})=><MemoryRouter>{children}</MemoryRouter>});
 let out;await act(async()=>{out=await result.current.runSerproOp("presumido","c","2026-09");});
 expect(out.ok).toBe(ok);
 expect(out.message).toMatch(/provisões/);
 if(!ok) expect(out.message).not.toMatch(/Valores reconciliados/);
 if(!ok && !reconciliacao?.alerta) expect(out.message).toMatch(/Reconciliação não confirmada/);
});
