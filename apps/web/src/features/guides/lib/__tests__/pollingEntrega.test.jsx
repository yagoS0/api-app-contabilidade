import { act, renderHook } from "@testing-library/react";
import { usePollingEntrega } from "../usePollingEntrega";
const guia=id=>[{id:"g",envio:{canais:[{canal:"WHATSAPP",destino:"teste",tentativaId:id,status:"enviado"}]}}];
beforeEach(()=>{jest.useFakeTimers();Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});});
afterEach(()=>jest.useRealTimers());
const avancar=async()=>act(async()=>{jest.advanceTimersByTime(2500);await Promise.resolve();});
test("24 ciclos são por tentativa; um reenvio novo reinicia a observação",async()=>{
 const atualizar=jest.fn(async()=>{});
 const {result,rerender}=renderHook(({id})=>usePollingEntrega(guia(id),atualizar,"pc"),{initialProps:{id:"t1"}});
 for(let i=0;i<24;i++) await avancar();
 expect(atualizar).toHaveBeenCalledTimes(24);expect(result.current.esgotou).toBe(true);
 await avancar();expect(atualizar).toHaveBeenCalledTimes(24);
 rerender({id:"t2"});await avancar();expect(atualizar).toHaveBeenCalledTimes(25);expect(result.current.esgotou).toBe(false);
});
test("troca da função de refresh não apaga orçamento nem cria polling sobreposto",async()=>{
 let terminar;const atualizar=jest.fn(()=>new Promise(r=>{terminar=r}));
 const {rerender,result}=renderHook(({fn})=>usePollingEntrega(guia("t1"),fn,"pc"),{initialProps:{fn:atualizar}});
 await avancar();rerender({fn:jest.fn()});await avancar();expect(atualizar).toHaveBeenCalledTimes(1);
 await act(async()=>{terminar();await Promise.resolve();});expect(result.current.ciclos).toBe(1);
});
