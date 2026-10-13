
import { createRealApi } from "../realApi";
test("token público não usa sessão do escritório nem aciona refresh ao expirar",async()=>{
 const anterior=global.fetch;global.fetch=jest.fn().mockResolvedValue({ok:false,status:401,json:async()=>({message:"Link expirado"})});
 try{const api=createRealApi();api.setAccessToken("sessao-escritorio");const handler=jest.fn();api.setUnauthorizedHandler(handler);
 await expect(api.consultarFormularioOnboarding("token-publico")).rejects.toThrow("Link expirado");
 expect(global.fetch).toHaveBeenCalledTimes(1);expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/public\/onboarding$/),expect.objectContaining({credentials:"omit",cache:"no-store",headers:expect.objectContaining({Authorization:"Bearer token-publico"})}));expect(handler).not.toHaveBeenCalled();
 }finally{global.fetch=anterior;}
});

test("requisição pública sem resposta termina e não repete o PATCH", async () => {
 jest.useFakeTimers(); const anterior = global.fetch;
 global.fetch = jest.fn(() => new Promise(() => {}));
 try {
  const api = createRealApi();
  const req = api.salvarFormularioOnboarding("token-publico", { versao: 1, dados: {}, finalizar: true });
  const resultado = expect(req).rejects.toMatchObject({ code: "timeout" });
  await jest.advanceTimersByTimeAsync(15000);
  await resultado;
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
 } finally { global.fetch = anterior; jest.useRealTimers(); }
});
