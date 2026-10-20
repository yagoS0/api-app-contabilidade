jest.mock("../../../../config.js", () => ({ INTEGRACAO_SERPRO_SITFIS: true }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: "12345678000199" } }) }));
const mockPost = jest.fn();
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn(() => ({ post: mockPost })) }));
import { obterRelatorio } from "../SerproSitfisService.js";
const base = { contribuinteCnpj: "11222333000181", contratanteCnpj: "12345678000199" };
beforeEach(() => jest.clearAllMocks());
test("revalida antes de abrir protocolo", async () => {
  const validarExecucao = jest.fn(async () => { throw new Error("revisao_alterada"); });
  await expect(obterRelatorio({ ...base, validarExecucao })).rejects.toThrow("revisao_alterada");
  expect(mockPost).not.toHaveBeenCalled();
});
test("protocolo recebido fica preservado mas retomada bloqueia Emitir", async () => {
  let alterada = false;
  mockPost.mockResolvedValue({ status: 200, data: { dados: JSON.stringify({ protocoloRelatorio: "protocolo-sintetico" }) } });
  const onProtocolo = jest.fn(async () => { alterada = true; });
  await expect(obterRelatorio({ ...base, onProtocolo, validarExecucao: async () => { if (alterada) throw new Error("revisao_alterada"); } })).rejects.toThrow("revisao_alterada");
  expect(onProtocolo).toHaveBeenCalledWith("protocolo-sintetico");
  expect(mockPost.mock.calls.map(([rota]) => rota)).toEqual(["/Apoiar"]);
});
test("falha ao salvar protocolo não permite próxima chamada paga", async () => {
  mockPost.mockResolvedValue({ status: 200, data: { dados: JSON.stringify({ protocoloRelatorio: "protocolo-recebido" }) } });
  await expect(obterRelatorio({ ...base, onProtocolo: async () => { throw new Error("persistencia_indisponivel"); } })).rejects.toThrow("persistencia_indisponivel");
  expect(mockPost.mock.calls.map(([rota]) => rota)).toEqual(["/Apoiar"]);
});