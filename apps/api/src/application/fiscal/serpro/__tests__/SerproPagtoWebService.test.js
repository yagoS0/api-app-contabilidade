jest.mock("../../../../config.js", () => ({
  INTEGRACAO_SERPRO_PAGTOWEB: true,
  SERPRO_PAGTOWEB_SYSTEM: "PAGTOWEB",
  SERPRO_PAGTOWEB_SERVICE_COMPROVANTE: "COMPARRECADACAO72",
}));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "99999999000199" } })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
jest.mock("pdf-parse", () => jest.fn());

import { confirmarPagamento } from "../SerproPagtoWebService.js";
import { SerproHttpClient } from "../SerproHttpClient.js";
import pdfParse from "pdf-parse";
import PDFDocument from "pdfkit";

const cnpj = "11222333000181";
const numeroDocumento = "07162619444412336";
const dados = { contribuinteCnpj: cnpj, numeroDocumento };
// Somente os identificadores são sintéticos. O bloco data/totais reproduz a fixture
// anonimizada já usada em comprovanteArrecadacao.test.js, inclusive a ordem MULTA/JUROS.
const texto = `Comprovante de Arrecadacao\nCNPJ 11.222.333/0001-81\nNumero do documento 07.16.26194.4441233-6\nData de Arrecadação\n04/08/2026\nDocumento pago via INTERNET\nTotais\n178,31 12,94 1,78 193,03`;
let pdf;
let post;

async function criarPdf(text = texto) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ compress: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica").text(text).end();
  });
}
const success = (changes = {}) => ({ status: 200, mensagens: [{ codigo: "Sucesso-PAGTOWEB-00000", texto: "Requisição efetuada com sucesso." }], dados: JSON.stringify({ pdf: pdf.toString("base64") }), ...changes });
const envelope = () => ({
  contribuinte: { numero: cnpj, tipo: 2 },
  pedidoDados: { idSistema: "PAGTOWEB", idServico: "COMPARRECADACAO72", versaoSistema: "1.0", dados: JSON.stringify({ numeroDocumento }) },
});
async function consultar(payload = success(), status = 200) {
  post.mockResolvedValue({ status, data: payload });
  return confirmarPagamento(dados);
}

beforeAll(async () => { pdf = await criarPdf(); });
beforeEach(() => {
  jest.clearAllMocks();
  post = jest.fn();
  SerproHttpClient.mockImplementation(() => ({ post }));
  pdfParse.mockResolvedValue({ text: texto, numpages: 1 });
});

describe("PAGTOWEB: evidência positiva, sem inferir inadimplência", () => {
  it("comprovante válido confirma documento e empresa e conserva composição real", async () => {
    const inicio = new Date();
    const r = await consultar();
    expect(r).toMatchObject({ pago: true, comprovantePdfBuffer: pdf, comprovante: { principal: 178.31, multa: 12.94, juros: 1.78, total: 193.03, confiavel: true }, resultadoConsulta: { estado: "CONFIRMADO", fonte: "PAGTOWEB", numeroDocumento, cnpj, cobertura: "COMPLETA", identidadeConferida: true, evidencia: { identidadeFonte: "COMPROVANTE_PDF" } } });
    expect(new Date(r.resultadoConsulta.consultadoEm).getTime()).toBeGreaterThanOrEqual(inicio.getTime());
    expect(r.resultadoConsulta.evidencia.pdfSha256).toMatch(/^[a-f\d]{64}$/);
  });
  it("aceita o envelope documentado e código entre colchetes", async () => {
    const payload = success({ ...envelope(), mensagens: [{ codigo: "[Sucesso-PAGTOWEB-00000]" }] });
    const r = await consultar(JSON.stringify(payload));
    expect(r.pago).toBe(true);
    expect(r.rawPayload).toBe(JSON.stringify(payload));
  });
  it("aceita PDF diretamente no campo dados, descrito no contrato", async () => {
    expect((await consultar(success({ dados: pdf.toString("base64") }))).pago).toBe(true);
  });
  it("lê realmente PDF comprimido sem rede e sem mock do parser", async () => {
    pdfParse.mockImplementation(jest.requireActual("pdf-parse"));
    const r = await consultar();
    expect(r.resultadoConsulta).toMatchObject({ estado: "CONFIRMADO", motivo: "COMPROVANTE_OFICIAL_CONFERIDO" });
    expect(r).toMatchObject({ pago: true, comprovante: { principal: 178.31, multa: 12.94, juros: 1.78, total: 193.03 } });
  });
  it.each([null, "", "{}", { mensagem: "Nenhum documento encontrado" }, { arquivo: "a".repeat(300) }])("sem PDF (%j) permanece inconclusivo", async (saida) => {
    expect(await consultar(success({ dados: saida }))).toMatchObject({ pago: null, comprovantePdfBuffer: null, resultadoConsulta: { estado: "INDETERMINADO" } });
  });
  it("retorno observado no piloto: Comprovante não existe não é negativa fiscal nem gatilho de aviso", async () => {
    const r = await consultar(success({ ...envelope(), dados: null,
      mensagens: [{ codigo: "Sucesso-PAGTOWEB-00000", texto: "Comprovante não existe." }] }));
    expect(r).toMatchObject({ pago: null, resultadoConsulta: {
      estado: "INDETERMINADO", motivo: "SEM_COMPROVANTE", cobertura: "PARCIAL", identidadeConferida: false,
    } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 422, 429, 202, 204, 302])("HTTP %i não confirma pagamento nem consulta negativa", async (status) => {
    const r = await consultar(success(), status);
    expect(r).toMatchObject({ pago: null, resultadoConsulta: { estado: "INDETERMINADO", motivo: `HTTP_${status}` } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it.each([500, 502, 503])("HTTP %i mantém erro técnico mesmo com PDF", async (status) => {
    await expect(consultar(success(), status)).rejects.toMatchObject({ code: "SERPRO_PAGTOWEB_INDISPONIVEL", details: { resultadoConsulta: { estado: "INDETERMINADO" } } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it.each([400, 403, 500, 202])("HTTP200 com status fiscal %i nunca processa PDF", async (status) => {
    expect((await consultar(success({ status }))).pago).toBeNull();
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it.each(["EntradaIncorreta-PAGTOWEB-00001", "EntradaIncorreta-PAGTOWEB-00002", "Erro-PAGTOWEB-00099", "Sucesso-Outro-00000", "NAO_LOCALIZADO"])('código "%s" dentro de HTTP200 não equivale a pagamento', async (codigo) => {
    const r = await consultar(success({ mensagens: [{ codigo, texto: "Documento não localizado" }] }));
    expect(r).toMatchObject({ pago: null, resultadoConsulta: { estado: "INDETERMINADO" } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it("erro junto ao sucesso prevalece sobre PDF", async () => {
    const r = await consultar(success({ mensagens: [...success().mensagens, { codigo: "EntradaIncorreta-PAGTOWEB-00002" }] }));
    expect(r.pago).toBeNull();
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it.each([{ status: 403 }, { mensagens: [{ codigo: "Erro-PAGTOWEB-00099" }] }, { erro: "Não foi possível consultar" }])("erro na saída anexa prevalece sobre sucesso de transporte (%#)", async (erro) => {
    expect(await consultar(success({ dados: { ...erro, pdf: pdf.toString("base64") } }))).toMatchObject({ pago: null, resultadoConsulta: { motivo: "SAIDA_FISCAL_DIVERGENTE" } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it.each([undefined, [], [{ texto: "Comprovante de pagamento não localizado" }]])("mensagem sem sucesso explícito não presume conclusão", async (mensagens) => {
    expect((await consultar(success({ mensagens }))).pago).toBeNull();
  });
  it("não trata PDF em pedidoDados/mensagem como comprovante retornado", async () => {
    expect((await consultar(success({ dados: null, pedidoDados: { pdf: pdf.toString("base64") }, mensagem: { arquivo: pdf.toString("base64") } }))).pago).toBeNull();
  });
});

describe("PAGTOWEB: estrutura e identidade do comprovante", () => {
  it.each([
    "a".repeat(200),
    Buffer.from("<html>erro de autorização</html>").toString("base64"),
    Buffer.from("%PDF-1.7 arquivo truncado").toString("base64"),
    "JVBERi0xLjQ=!!!!",
  ])("recusa base64 inválido, conteúdo não PDF e truncamento (%#)", async (pdfInvalido) => {
    expect(await consultar(success({ dados: { pdf: pdfInvalido } }))).toMatchObject({ pago: null, resultadoConsulta: { motivo: "PDF_INVALIDO" } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it("não confia apenas no magic/EOF para validar um PDF", async () => {
    pdfParse.mockImplementation(jest.requireActual("pdf-parse"));
    const fake = Buffer.from("%PDF-1.7\nobjeto inexistente\n%%EOF").toString("base64");
    expect(await consultar(success({ dados: { pdf: fake }, ...envelope() }))).toMatchObject({ pago: null, resultadoConsulta: { motivo: "PDF_ILEGIVEL" } });
  });
  it.each([0, undefined, "1"])("PDF sem páginas comprovadas (%j) não confirma", async (numpages) => {
    pdfParse.mockResolvedValue({ text: texto, numpages });
    expect(await consultar()).toMatchObject({ pago: null, resultadoConsulta: { motivo: "PDF_SEM_PAGINAS" } });
  });
  it.each([
    texto.replace("11.222.333/0001-81", "55.666.777/0001-88"),
    texto.replace("07.16.26194.4441233-6", "07.16.26194.4441234-4"),
  ])("PDF de outro documento/empresa vence até envelope coincidente (%#)", async (text) => {
    pdfParse.mockResolvedValue({ text, numpages: 1 });
    expect(await consultar(success(envelope()))).toMatchObject({ pago: null, comprovantePdfBuffer: null, resultadoConsulta: { estado: "PARCIAL_OU_DIVERGENTE", motivo: "IDENTIDADE_COMPROVANTE_DIVERGENTE" } });
  });
  it.each([
    { contribuinte: { numero: "55666777000188", tipo: 2 } },
    { contribuinte: { numero: cnpj, tipo: 1 } },
    { pedidoDados: { ...envelope().pedidoDados, dados: JSON.stringify({ numeroDocumento: "07162619444412344" }) } },
    { pedidoDados: { ...envelope().pedidoDados, idServico: "PAGAMENTOS71" } },
  ])("recusa envelope de outra identidade/operação (%#)", async (change) => {
    expect(await consultar(success({ ...envelope(), ...change }))).toMatchObject({ pago: null, resultadoConsulta: { estado: "PARCIAL_OU_DIVERGENTE", motivo: "IDENTIDADE_ENVELOPE_DIVERGENTE" } });
    expect(pdfParse).not.toHaveBeenCalled();
  });
  it("não confirma PDF sem identidade por apenas existir arquivo", async () => {
    pdfParse.mockResolvedValue({ text: "Totais\n100,00 0,00 0,00 100,00", numpages: 1 });
    expect(await consultar()).toMatchObject({ pago: null, resultadoConsulta: { motivo: "IDENTIDADE_NAO_DEMONSTRADA" } });
  });
  it("preserva PDF oficial válido quando envelope demonstra identidade apesar de extração vazia", async () => {
    pdfParse.mockResolvedValue({ text: "", numpages: 1 });
    expect(await consultar(success(envelope()))).toMatchObject({ pago: true, comprovantePdfBuffer: pdf, comprovante: { confiavel: false, dataArrecadacao: null }, resultadoConsulta: { evidencia: { identidadeFonte: "ENVELOPE_OFICIAL" } } });
  });
  it("falha somente na extração da página permite validar estrutura e identidade do envelope", async () => {
    pdfParse.mockImplementation(async (_buffer, options) => ({ numpages: 1, text: await options.pagerender({ getTextContent: async () => { throw Error("extração indisponível"); } }) }));
    expect(await consultar(success(envelope()))).toMatchObject({ pago: true, comprovante: { confiavel: false }, resultadoConsulta: { evidencia: { identidadeFonte: "ENVELOPE_OFICIAL" } } });
  });
  it("retorno com mais de um documento no PDF exige revisão", async () => {
    pdfParse.mockResolvedValue({ text: `${texto}\nOutro documento 07162619444412344`, numpages: 1 });
    expect(await consultar()).toMatchObject({ pago: null, resultadoConsulta: { estado: "PARCIAL_OU_DIVERGENTE" } });
  });
  it("identidade correta sem composição confiável não inventa valores", async () => {
    pdfParse.mockResolvedValue({ text: texto.replace("178,31 12,94 1,78 193,03", "100,00 10,00 5,00 200,00"), numpages: 1 });
    expect(await consultar()).toMatchObject({ pago: true, comprovante: { confiavel: false, principal: null, multa: null, juros: null } });
  });
  it("aceita identificadores sem máscara", async () => {
    pdfParse.mockResolvedValue({ text: texto.replace("11.222.333/0001-81", cnpj).replace("07.16.26194.4441233-6", numeroDocumento), numpages: 1 });
    expect((await consultar()).pago).toBe(true);
  });
  it("passa envelope correto e normaliza máscara sem modificar transporte/guardas", async () => {
    post.mockResolvedValue({ status: 200, data: success() });
    await confirmarPagamento({ ...dados, numeroDocumento: "07.16.26194.4441233-6" });
    expect(post).toHaveBeenCalledWith("/Emitir", { contratante: { numero: "99999999000199", tipo: 2 }, autorPedidoDados: { numero: "99999999000199", tipo: 2 }, contribuinte: { numero: cnpj, tipo: 2 }, pedidoDados: { idSistema: "PAGTOWEB", idServico: "COMPARRECADACAO72", versaoSistema: "1.0", dados: JSON.stringify({ numeroDocumento }) } }, { raw: true, validateStatus: expect.any(Function) });
  });
  it.each([null, "abc", "1".repeat(18)])("documento inválido não produz consulta fiscal (%j)", async (numero) => {
    await expect(confirmarPagamento({ ...dados, numeroDocumento: numero })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it("erro de orçamento/rede mantém código e objeto originais", async () => {
    const err = Object.assign(new Error("limite"), { code: "SERPRO_BUDGET_EXCEEDED" });
    post.mockRejectedValue(err);
    await expect(confirmarPagamento(dados)).rejects.toBe(err);
  });
});
