jest.mock("../../../../config.js", () => ({ INTEGRACAO_SERPRO_PAGTOWEB: true, SERPRO_PAGTOWEB_SYSTEM: "PAGTOWEB", SERPRO_PAGTOWEB_SERVICE_COMPROVANTE: "COMPARRECADACAO72" }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "11111111000191" } })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
import { SerproHttpClient } from "../SerproHttpClient.js";
import { confirmarPagamento } from "../SerproPagtoWebService.js";
const post = jest.fn();
const run = () => confirmarPagamento({ contribuinteCnpj: "22222222000191", numeroDocumento: "123" });
beforeEach(() => { jest.clearAllMocks(); SerproHttpClient.mockImplementation(() => ({ post })); });
test.each([[401, "Não autorizado"], [403, "Sem procuração"], [400, "Certificado inexistente"], [400, "Nenhum serviço encontrado"], [200, ""], [500, "Comprovante não localizado"]])("retorno técnico %s %s nunca é negativa de pagamento", async (status, texto) => {
  post.mockResolvedValue({ status, data: { mensagens: [{ texto }] } });
  await expect(run()).rejects.toHaveProperty("code"); expect(post).toHaveBeenCalledTimes(1);
});
test("resposta explícita correlacionada não localizada é negativa concluída", async () => {
  post.mockResolvedValue({ status: 200, data: { status: 200, mensagens: [{ texto: "Comprovante de pagamento não localizado." }] } });
  expect(await run()).toMatchObject({ pago: false, mensagem: "Comprovante de pagamento não localizado." });
});
test.each([200, 500])("texto base64 em arquivo não confirma pagamento HTTP%s", async status => {
  post.mockResolvedValue({ status, data: { dados: { arquivo: Buffer.from("x".repeat(150)).toString("base64") } } });
  await expect(run()).rejects.toHaveProperty("code");
});
