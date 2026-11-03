import { act, renderHook } from "@testing-library/react";
import { useManageAccountingWorkspace } from "../useManageAccountingWorkspace";

function montar(over = {}) {
  const api = { getChartOfAccounts:async()=>[],getCircular:async()=>({provisoes:[],receitas:{},extrato:{}}),getCircularAccountingEntries:async()=>({entries:[]}),
    updateCircular:jest.fn(async()=>({ok:true,circular:{id:"circ"},accounting:{ok:false,reason:"mes_fechado"}})),...over };
  const hook = renderHook(({id})=>useManageAccountingWorkspace({api,page:"companyDetail",selectedCompanyId:id,companyDetailTab:"circular"}),{initialProps:{id:"c"}});
  return {...hook,api};
}
test("salvamento não anuncia geração quando contabilização falha e recarga não apaga motivo",async()=>{
  const t=montar(); await act(async()=>{});
  await act(async()=>{await t.result.current.handleSaveCircular({receitaBruta:100});});
  expect(t.result.current.entriesError).toMatch(/Circular salva.*Mês contábil fechado/);
  expect(t.result.current.entriesMessage).toBe(""); expect(t.api.updateCircular).toHaveBeenCalledTimes(1);
});
test("falha de leitura após gravação mantém ambas as pendências sem repetir escrita",async()=>{
  const t=montar(); await act(async()=>{});
  t.api.getCircular=async()=>{throw Error("Leitura indisponível");};
  await act(async()=>{await t.result.current.handleSaveCircular({receitaBruta:100});});
  expect(t.result.current.entriesError).toMatch(/Leitura indisponível.*Circular salva/);
  expect(t.api.updateCircular).toHaveBeenCalledTimes(1);
});
test("resposta vazia do salvamento e baixa DAS sintética não geram sucesso",async()=>{
  const t=montar({updateCircular:jest.fn(async()=>undefined),createBaixa:jest.fn()}); await act(async()=>{});
  await act(async()=>{await t.result.current.handleSaveCircular({});});
  expect(t.result.current.entriesError).toMatch(/sem confirmação/);
  await expect(t.result.current.handleCreateBaixa("synthetic-das-g",{})).rejects.toThrow(/sem provisão/);
  expect(t.api.createBaixa).not.toHaveBeenCalled();
});
test("salvamento tardio não escreve feedback na outra empresa",async()=>{
  let concluir; const t=montar({updateCircular:()=>new Promise(r=>{concluir=r;})}); await act(async()=>{});
  let chamada; act(()=>{chamada=t.result.current.handleSaveCircular({});});
  t.rerender({id:"outra"}); await act(async()=>{});
  await act(async()=>{concluir({ok:true,circular:{},accounting:{ok:false,reason:"mes_fechado"}});await chamada;});
  expect(t.result.current.entriesError).toBe(""); expect(t.result.current.entriesMessage).toBe("");
});
