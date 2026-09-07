import { createApiClient } from "../client";
import { createMockApi } from "../mock/mockApi";
import { createRealApi } from "../real/realApi";
jest.mock("../mock/mockApi", () => ({ createMockApi: jest.fn() }));
jest.mock("../real/realApi", () => ({ createRealApi: jest.fn() }));
const modeAntes = process.env.VITE_API_MODE;
afterEach(() => {
  if (modeAntes === undefined) delete process.env.VITE_API_MODE;
  else process.env.VITE_API_MODE = modeAntes;
  jest.clearAllMocks();
});
test.each([
  "postClassificarIa", "getConsumoIa", "definirCanalEnvio", "resendGuideEmail",
  "getResumoWhatsapp", "listarConversasWhatsapp", "getMensagensWhatsapp", "getCanalWhatsapp",
  "responderConversaWhatsapp", "vincularConversaWhatsapp", "enviarDocumentoWhatsapp", "enviarGuiaWhatsapp",
  "listarOnboardings", "criarOnboarding", "salvarOnboarding", "getOnboarding", "converterOnboarding",
])("%s preserva recusa real sem fabricar sucesso mock no fallback", async (nome) => {
  process.env.VITE_API_MODE = "real_with_mock_fallback";
  const erro = Object.assign(new Error("recusa real"), { status: 409 });
  const real = jest.fn().mockRejectedValue(erro);
  const mock = jest.fn().mockResolvedValue({ ok: true });
  createRealApi.mockReturnValue({ [nome]: real });
  createMockApi.mockReturnValue({ [nome]: mock });
  await expect(createApiClient()[nome]("id")).rejects.toBe(erro);
  expect(mock).not.toHaveBeenCalled();
});
test("modo mock explícito continua exercitando o fluxo offline", async () => {
  process.env.VITE_API_MODE = "mock";
  const mock = jest.fn().mockResolvedValue({ itens: [] });
  createRealApi.mockReturnValue({}); createMockApi.mockReturnValue({ listarOnboardings: mock });
  await expect(createApiClient().listarOnboardings()).resolves.toEqual({ itens: [] });
});
test("nenhuma operação real cai silenciosamente no mock", async () => {
  process.env.VITE_API_MODE = "real_with_mock_fallback";
  createRealApi.mockReturnValue({ outraLeitura: jest.fn().mockRejectedValue(new Error("offline")) });
  createMockApi.mockReturnValue({ outraLeitura: jest.fn().mockResolvedValue({ ok: true }) });
  await expect(createApiClient().outraLeitura()).rejects.toThrow("offline");
});
