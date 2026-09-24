import { parseDasIndexResponse, consultarDasIndexPorCompetencia } from "../SerproPgdasDeclaracaoService.js";
import { SerproPgdasdService } from "../SerproPgdasdService.js";
import { getResolvedSerproCredentials } from "../SerproRuntimeSettings.js";

jest.mock("../SerproPgdasdService.js", () => ({ SerproPgdasdService: jest.fn() }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn() }));
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

const CNPJ = "12345678000199";
const DOC = "07202600000000001";
const DOC2 = "07202600000000002";
const options = { competencia: "2026-08", contribuinteCnpj: CNPJ, consultadoEm: "2026-09-25T12:00:00.000Z" };
const op = (numeroDas = DOC, dasPago = false, extra = {}) => ({ tipoOperacao: "Geração de DAS", indiceDas: {
  numeroDas, dasPago, datahoraEmissaoDas: "20260920123000", ...extra,
} });
const payload = (operacoes = [op()], periodoApuracao = 202608) => ({ status: 200, dados: JSON.stringify({
  anoCalendario: 2026, periodo: { periodoApuracao, operacoes },
}) });
const parse = (response, extra = {}) => parseDasIndexResponse(response, { ...options, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  getResolvedSerproCredentials.mockResolvedValue({ certificate: { document: "98765432000199" } });
});

test.each([true, false])("somente booleano documentado produz observação conclusiva: %s", dasPago => {
  const r = parse(payload([op(DOC, dasPago)]));
  expect(r.dasPago).toBe(dasPago);
  expect(r.resultadoConsulta).toMatchObject({ estado: dasPago ? "CONFIRMADO" : "NAO_LOCALIZADO",
    consultadoEm: options.consultadoEm, identidadeConferida: true, cobertura: "COMPLETA", numeroDocumento: DOC });
  expect(r.dataHoraEmissaoDas).toBe("2026-09-20T15:30:00.000Z");
});

test.each([null, "", "false", "true", 0, 1, {}, []])("sinal inválido nunca vira não pago: %j", value => {
  expect(parse(payload([op(DOC, value)]))).toMatchObject({ dasPago: null, resultadoConsulta: { estado: "INDETERMINADO" } });
});

test("campo dasPago ausente nunca vira falso", () => {
  const semSinal = op(); delete semSinal.indiceDas.dasPago;
  expect(parse(payload([semSinal])).dasPago).toBeNull();
});

test("HTTP 200 com erro fiscal não aproveita índice eventualmente presente", () => {
  expect(parse({ ...payload(), mensagens: [{ codigo: "Erro-PGDASD-00099" }] }).resultadoConsulta.estado).toBe("INDETERMINADO");
});

test.each([{}, { dados: "html" }, { dados: "[]" }, { status: 500, dados: payload().dados }, payload([], 202607)])("payload/período inválido fica inconclusivo: %j", response => {
  expect(parse(response).resultadoConsulta.estado).toBe("INDETERMINADO");
});

test("seleciona o documento exato, não o primeiro DAS pago antigo", () => {
  const response = payload([op(DOC, true), op(DOC2, false)]);
  expect(parse(response, { numeroDocumento: DOC2 })).toMatchObject({ numeroDocumento: DOC2, dasPago: false });
  expect(parse(response)).toMatchObject({ dasPago: null, resultadoConsulta: { motivo: "MULTIPLOS_DOCUMENTOS_NO_PERIODO" } });
});

test("negativa do DAS antigo mantém documento exato e impede aviso se outra versão já foi paga", () => {
  const r = parse(payload([op(DOC, false), op(DOC2, true)]), { numeroDocumento: DOC });
  expect(r.resultadoConsulta).toMatchObject({ estado: "NAO_LOCALIZADO", numeroDocumento: DOC,
    evidencia: { periodoPgdas: { competencia: "2026-08", cobertura: "COMPLETA", impedimentoAviso: "OUTRO_DAS_PAGO_NO_PERIODO",
      documentos: [{ numeroDocumento: DOC, dasPago: false }, { numeroDocumento: DOC2, dasPago: true }] } } });
});

test("dois DAS não pagos têm vigência ambígua e não autorizam aviso pelo índice individual", () => {
  const r = parse(payload([op(DOC, false), op(DOC2, false)]), { numeroDocumento: DOC });
  expect(r.dasPago).toBe(false);
  expect(r.resultadoConsulta.evidencia.periodoPgdas.impedimentoAviso).toBe("MULTIPLOS_DOCUMENTOS_NO_PERIODO");
});

test.each([op(DOC2, "false"), op("123", true), { indiceDas: "inválido" }, null])("operação incompleta no PA impede aviso sem alterar sinal exato %j", invalida => {
  const r = parse(payload([op(DOC, false), invalida]), { numeroDocumento: DOC });
  expect(r.dasPago).toBe(false);
  expect(r.resultadoConsulta.evidencia.periodoPgdas).toMatchObject({ cobertura: "PARCIAL", impedimentoAviso: expect.any(String) });
});

test("documento único false é elegível; duplicata idêntica não inventa uma segunda versão", () => {
  const r = parse(payload([op(DOC, false), op(DOC, false)]), { numeroDocumento: DOC });
  expect(r.resultadoConsulta.evidencia.periodoPgdas).toEqual({ competencia: "2026-08", cobertura: "COMPLETA", impedimentoAviso: null,
    documentos: [{ numeroDocumento: DOC, dasPago: false }] });
});

test("retificadora posterior à guia exata conserva negativo mas impede aviso da obrigação", () => {
  const r = parse(payload([op(DOC, false), { indiceDeclaracao: { dataHoraTransmissao: "20260922120000" } }]), { numeroDocumento: DOC });
  expect(r.dasPago).toBe(false);
  expect(r.resultadoConsulta.evidencia.periodoPgdas.impedimentoAviso).toBe("DECLARACAO_POSTERIOR_OU_SEM_DATA");
});

test("DAS pago de outro PA não impede aviso do único DAS false do PA consultado", () => {
  const response = { dados: JSON.stringify({ periodos: [
    { periodoApuracao: 202607, operacoes: [op(DOC2, true)] },
    { periodoApuracao: 202608, operacoes: [op(DOC, false)] },
  ] }) };
  expect(parse(response, { numeroDocumento: DOC }).resultadoConsulta.evidencia.periodoPgdas).toEqual({
    competencia: "2026-08", cobertura: "COMPLETA", impedimentoAviso: null, documentos: [{ numeroDocumento: DOC, dasPago: false }],
  });
});

test("seleciona o período correto em resposta anual e nunca transfere pagamento entre empresas", () => {
  const response = { dados: JSON.stringify({ periodos: [
    { periodoApuracao: 202607, operacoes: [op(DOC, true)] },
    { periodoApuracao: 202608, operacoes: [op(DOC2, false)] },
  ] }) };
  expect(parse(response, { numeroDocumento: DOC2 }).dasPago).toBe(false);
  expect(parse(response, { numeroDocumento: DOC }).dasPago).toBeNull();
  expect(parse({ ...payload(), contribuinte: { numero: "99999999000199" } }).resultadoConsulta.motivo).toBe("CNPJ_DIVERGENTE");
});

test("DAS único anterior a uma retificadora não quita a apuração atual sem vínculo", () => {
  const response = payload([op(DOC, true), { tipoOperacao: "Retificadora", indiceDeclaracao: {
    numeroDeclaracao: "00000000202608002", dataHoraTransmissao: "20260922120000",
  } }]);
  expect(parse(response).resultadoConsulta.motivo).toBe("DECLARACAO_POSTERIOR_OU_SEM_DATA");
  // A consulta da guia antiga pode confirmar o seu próprio documento, sem alcançar outra guia.
  expect(parse(response, { numeroDocumento: DOC }).dasPago).toBe(true);
});

test("avulso sem vínculo, duplicata contraditória e número inválido ficam inconclusivos", () => {
  expect(parse(payload([{ ...op(), tipoOperacao: "DAS Avulso" }])).dasPago).toBeNull();
  expect(parse(payload([op(DOC, true), op(DOC, false)]), { numeroDocumento: DOC }).dasPago).toBeNull();
  expect(parse(payload(), { numeroDocumento: CNPJ }).resultadoConsulta.motivo).toBe("NUMERO_DOCUMENTO_INVALIDO");
});

test("na rodada compartilha uma única consulta sem compartilhar a decisão por documento", async () => {
  const consultarDeclaracaoIndice = jest.fn(async () => payload([op(DOC, true), op(DOC2, false)]));
  SerproPgdasdService.mockImplementation(() => ({ consultarDeclaracaoIndice }));
  const consultasDaRodada = new Map();
  const a = { portalClientId: "empresa", ...options, consultasDaRodada };
  const [primeira, segunda] = await Promise.all([
    consultarDasIndexPorCompetencia({ ...a, numeroDocumento: DOC }),
    consultarDasIndexPorCompetencia({ ...a, numeroDocumento: DOC2 }),
  ]);
  expect(consultarDeclaracaoIndice).toHaveBeenCalledTimes(1);
  expect(primeira.dasPago).toBe(true); expect(segunda.dasPago).toBe(false);
  expect(primeira.resultadoConsulta.consultadoEm).toBe(segunda.resultadoConsulta.consultadoEm);
  await consultarDasIndexPorCompetencia({ ...a, consultasDaRodada: new Map(), numeroDocumento: DOC });
  expect(consultarDeclaracaoIndice).toHaveBeenCalledTimes(2);
  expect(consultarDeclaracaoIndice.mock.calls[0][0]).not.toHaveProperty("forcar");
});

test("falha de orçamento não vira não localizado nem segunda chamada na mesma rodada", async () => {
  const err = Object.assign(new Error("limite"), { code: "SERPRO_TETO_MENSAL" });
  const consultarDeclaracaoIndice = jest.fn(async () => { throw err; });
  SerproPgdasdService.mockImplementation(() => ({ consultarDeclaracaoIndice }));
  const a = { portalClientId: "empresa", ...options, consultasDaRodada: new Map() };
  await expect(consultarDasIndexPorCompetencia(a)).rejects.toBe(err);
  await expect(consultarDasIndexPorCompetencia({ ...a, numeroDocumento: DOC2 })).rejects.toBe(err);
  expect(consultarDeclaracaoIndice).toHaveBeenCalledTimes(1);
  expect(err.resultadoConsulta).toMatchObject({ estado: "INDETERMINADO", motivo: "SERPRO_TETO_MENSAL" });
});

test("lease perdida impede a consulta externa", async () => {
  const consultarDeclaracaoIndice = jest.fn();
  SerproPgdasdService.mockImplementation(() => ({ consultarDeclaracaoIndice }));
  await expect(consultarDasIndexPorCompetencia({ ...options, assertActive: () => { throw new Error("LEASE_PERDIDA"); } })).rejects.toThrow("LEASE_PERDIDA");
  expect(consultarDeclaracaoIndice).not.toHaveBeenCalled();
});
