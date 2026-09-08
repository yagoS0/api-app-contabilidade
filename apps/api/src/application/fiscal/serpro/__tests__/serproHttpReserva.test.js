import axios from "axios";
import { SerproHttpClient } from "../SerproHttpClient.js";
import { autorizarChamada, concluirChamada } from "../SerproCallGuard.js";
jest.mock("axios", () => ({ request: jest.fn(), isAxiosError: (error) => Boolean(error?.isAxiosError) }));
jest.mock("../SerproCallGuard.js", () => ({ autorizarChamada: jest.fn(), concluirChamada: jest.fn() }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async()=>({baseUrl:"https://invalid.test",timeoutMs:1000})) }));
function cliente(auth = {}) {
  return new SerproHttpClient({authService:{ authenticate: jest.fn(async()=>({accessToken:"test",jwtToken:"test"})),buildHttpsAgent:jest.fn(async()=>null), ...auth }});
}
beforeEach(()=>{jest.clearAllMocks(); autorizarChamada.mockResolvedValue({id:"r",inicio:Date.now()}); concluirChamada.mockResolvedValue();});
test("autenticação falha antes do HTTP: fecha reserva como abortada_auth", async()=>{
  const client=cliente({authenticate:jest.fn(async()=>{throw Object.assign(new Error("auth"),{code:"AUTH"});})});
  await expect(client.post("/Emitir",{})).rejects.toMatchObject({code:"SERPRO_REQUEST_FAILED"});
  expect(axios.request).not.toHaveBeenCalled();
  expect(concluirChamada).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({abortadaAuth:true,erroCodigo:"AUTH"}));
});
test("guarda indisponível não autentica nem envia",async()=>{
  const auth=jest.fn(); const client=cliente({authenticate:auth}); autorizarChamada.mockRejectedValue(new Error("medição indisponível"));
  await expect(client.post("/Emitir",{})).rejects.toThrow("medição"); expect(auth).not.toHaveBeenCalled();expect(axios.request).not.toHaveBeenCalled();
});
test.each([400,429,503])("resposta raw HTTP %s é registrada como erro e preservada ao chamador",async(status)=>{
  axios.request.mockResolvedValue({status,data:{mensagem:"falha"},headers:{}});
  expect((await cliente().post("/Emitir",{},{raw:true})).status).toBe(status);
  expect(concluirChamada).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({httpStatus:status,erroCodigo:`HTTP_${status}`}));
});
test("raw lançado por axios preserva 304 sem classificar como falha fiscal",async()=>{
  axios.request.mockRejectedValue({response:{status:304,data:{},headers:{}}});
  expect((await cliente().post("/Apoiar",{},{raw:true})).status).toBe(304);
  expect(concluirChamada).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({httpStatus:304,erroCodigo:null}));
});
test("falha do ledger após HTTP não finaliza duas vezes nem reenvia",async()=>{
  axios.request.mockResolvedValue({status:200,data:{ok:true}});
  concluirChamada.mockRejectedValue(Object.assign(new Error("não repetir"),{code:"SERPRO_REGISTRO_INDETERMINADO"}));
  await expect(cliente().post("/Declarar",{})).rejects.toMatchObject({code:"SERPRO_REGISTRO_INDETERMINADO"});
  expect(concluirChamada).toHaveBeenCalledTimes(1);expect(axios.request).toHaveBeenCalledTimes(1);
});
test("timeout preserva resultado desconhecido no ledger antes de devolver erro",async()=>{
  axios.request.mockRejectedValue({isAxiosError:true,code:"ECONNABORTED",message:"timeout"});
  await expect(cliente().post("/Consultar",{})).rejects.toMatchObject({code:"SERPRO_TIMEOUT"});
  expect(concluirChamada).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({httpStatus:null,erroCodigo:"SERPRO_TIMEOUT"}));
  expect(axios.request).toHaveBeenCalledTimes(1);
});
