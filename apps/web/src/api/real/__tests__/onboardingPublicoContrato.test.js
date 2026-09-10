
import { createRealApi } from "../realApi";
test("token público não usa sessão do escritório nem aciona refresh ao expirar",async()=>{
 const anterior=global.fetch;global.fetch=jest.fn().mockResolvedValue({ok:false,status:401,json:async()=>({message:"Link expirado"})});
 try{const api=createRealApi();api.setAccessToken("sessao-escritorio");const handler=jest.fn();api.setUnauthorizedHandler(handler);
 await expect(api.consultarFormularioOnboarding("token-publico")).rejects.toThrow("Link expirado");
 expect(global.fetch).toHaveBeenCalledTimes(1);expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/public\/onboarding$/),expect.objectContaining({credentials:"omit",cache:"no-store",headers:expect.objectContaining({Authorization:"Bearer token-publico"})}));expect(handler).not.toHaveBeenCalled();
 }finally{global.fetch=anterior;}
});
