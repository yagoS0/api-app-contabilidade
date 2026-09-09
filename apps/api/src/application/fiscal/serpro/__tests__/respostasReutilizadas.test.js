import axios from "axios";
import { SerproHttpClient } from "../SerproHttpClient.js";
import { chaveResposta, lerResposta, guardarResposta } from "../SerproRespostaCache.js";
import { comContextoSerpro } from "../serproCallContext.js";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { autorizarChamada, concluirChamada } from "../SerproCallGuard.js";
jest.mock("axios", () => ({ request: jest.fn(), isAxiosError: () => false }));
jest.mock("../SerproCallGuard.js", () => ({ autorizarChamada: jest.fn(async () => ({ id: "r1" })), concluirChamada: jest.fn() }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: async () => ({ baseUrl: "https://invalid.test", timeoutMs: 10 }) }));
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { serproRespostaCache: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() } } }));
const payload = { contribuinte: { numero: "12345678000199" }, pedidoDados: { idServico: "GERARDAS12", dados: '{"periodoApuracao":"202608","campo":1}' } };
const cliente = () => new SerproHttpClient({ authService: { authenticate: async () => ({ accessToken: "test" }), buildHttpsAgent: async () => null } });
beforeEach(() => { jest.clearAllMocks(); prisma.serproRespostaCache.findUnique.mockResolvedValue(null); prisma.serproRespostaCache.upsert.mockResolvedValue({}); axios.request.mockResolvedValue({ status: 200, data: { pdf: "fixture" }, headers: {} }); });
test("ordem de propriedades externa e do JSON interno não muda a assinatura", () => {
  expect(chaveResposta(payload, "/Emitir")).toBe(chaveResposta({ pedidoDados: { dados: '{"campo":1,"periodoApuracao":"202608"}', idServico: "GERARDAS12" }, contribuinte: payload.contribuinte }, "/Emitir"));
  expect(chaveResposta(payload, "/Emitir")).not.toBe(chaveResposta({ ...payload, contribuinte: { numero: "99999999000199" } }, "/Emitir"));
});
test("resposta persistida permite repetir processamento em outro client sem novo HTTP", async () => {
  const primeira = await cliente().post("/Emitir", payload);
  const row = prisma.serproRespostaCache.upsert.mock.calls[0][0].create;
  prisma.serproRespostaCache.findUnique.mockResolvedValue(row);
  expect(await cliente().post("/Emitir", payload)).toEqual(primeira);
  expect(axios.request).toHaveBeenCalledTimes(1);
  expect(autorizarChamada).toHaveBeenCalledTimes(1);
});
test("atualização explícita invalida a resposta e faz nova tentativa", async () => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ resposta: { antiga: true }, expiraEm: new Date(Date.now() + 60000) });
  await comContextoSerpro({ atualizar: true }, () => cliente().post("/Emitir", payload));
  expect(prisma.serproRespostaCache.deleteMany).toHaveBeenCalledWith({ where: { chave: chaveResposta(payload, "/Emitir") } });
  expect(axios.request).toHaveBeenCalledTimes(1);
});
test("falha de gravação preserva reserva e não afirma finalização", async () => {
  prisma.serproRespostaCache.upsert.mockRejectedValueOnce(new Error("db"));
  await expect(cliente().post("/Emitir", payload)).rejects.toMatchObject({ code: "SERPRO_REGISTRO_INDETERMINADO" });
  expect(concluirChamada).not.toHaveBeenCalled(); expect(axios.request).toHaveBeenCalledTimes(1);
});
test("cache indisponível falha antes de gerar consumo", async () => {
  prisma.serproRespostaCache.findUnique.mockRejectedValueOnce(new Error("db"));
  await expect(cliente().post("/Emitir", payload)).rejects.toThrow("db");
  expect(axios.request).not.toHaveBeenCalled(); expect(autorizarChamada).not.toHaveBeenCalled();
});
test("expirado, transmissão e polling não usam resposta salva", async () => {
  prisma.serproRespostaCache.findUnique.mockResolvedValue({ resposta: {}, expiraEm: new Date(0) });
  expect(await lerResposta(payload, "/Emitir")).toBeNull();
  prisma.serproRespostaCache.findUnique.mockClear();
  for (const idServico of ["TRANSDECLARACAO11", "RELATORIOSITFIS92", "COMPARRECADACAO72"]) {
    const p = { pedidoDados: { idServico } };
    expect(await lerResposta(p, "/Emitir")).toBeNull();
    await guardarResposta(p, "/Emitir", { status: 200, data: {} });
  }
  expect(prisma.serproRespostaCache.findUnique).not.toHaveBeenCalled();
  expect(prisma.serproRespostaCache.upsert).not.toHaveBeenCalled();
});
