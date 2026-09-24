jest.mock("../../../../config.js", () => ({ INTEGRACAO_SERPRO_PAGTOWEB: true, SERPRO_PAGTOWEB_SYSTEM: "PAGTOWEB", SERPRO_PAGTOWEB_SERVICE_COMPROVANTE: "COMPARRECADACAO72" }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "11111111000191" } })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
import { SerproHttpClient } from "../SerproHttpClient.js";
import { confirmarPagamento } from "../SerproPagtoWebService.js";
const post = jest.fn();
const run = () => confirmarPagamento({ contribuinteCnpj: "22222222000191", numeroDocumento: "07202600000000001" });
beforeEach(() => { jest.clearAllMocks(); SerproHttpClient.mockImplementation(() => ({ post })); });
test.each([[401, "Não autorizado"], [403, "Sem procuração"], [400, "Certificado inexistente"], [400, "Nenhum serviço encontrado"], [200, ""], [500, "Comprovante não localizado"]])("retorno técnico %s %s nunca é negativa de pagamento", async (status, texto) => {
  post.mockResolvedValue({ status, data: { mensagens: [{ texto }] } });
  if (status >= 500) await expect(run()).rejects.toMatchObject({ code: "SERPRO_PAGTOWEB_INDISPONIVEL", details: { resultadoConsulta: { estado: "INDETERMINADO" } } });
  else expect(await run()).toMatchObject({ pago: null, resultadoConsulta: { estado: "INDETERMINADO" } });
  expect(post).toHaveBeenCalledTimes(1);
});
test.each(["Comprovante de pagamento não localizado.", "Comprovante não existe."])("ausência explícita de comprovante não prova ausência de pagamento: %s", async texto => {
  post.mockResolvedValue({ status: 200, data: { status: 200, dados: null,
    mensagens: [{ codigo: "Sucesso-PAGTOWEB-00000", texto }] } });
  expect(await run()).toMatchObject({ pago: null, mensagem: texto, resultadoConsulta: { estado: "INDETERMINADO", motivo: "SEM_COMPROVANTE" } });
});
test.each([200, 500])("texto base64 em arquivo não confirma pagamento HTTP%s", async status => {
  post.mockResolvedValue({ status, data: { mensagens: [{ codigo: "Sucesso-PAGTOWEB-00000" }], dados: { arquivo: Buffer.from("x".repeat(150)).toString("base64") } } });
  if (status >= 500) await expect(run()).rejects.toMatchObject({ code: "SERPRO_PAGTOWEB_INDISPONIVEL" });
  else expect(await run()).toMatchObject({ pago: null, resultadoConsulta: { estado: "INDETERMINADO", motivo: "SEM_COMPROVANTE" } });
});
