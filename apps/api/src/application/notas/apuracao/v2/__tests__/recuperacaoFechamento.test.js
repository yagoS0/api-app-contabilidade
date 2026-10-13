jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    aggregate: jest.fn(async () => ({ _sum: { total: 0 } })),
    count: jest.fn(async () => 0),
    create: jest.fn(async (args) => ({ id: "novo", ...(args?.data || {}) })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(async (args) => ({ id: "existente", ...(args?.data || {}) })),
  });
  return {
    prisma: {
      portalClient: model(),
      entregaObrigacaoArquivo: model(),
      portalInvoice: model(),
      apuracaoSnapshot: model(),
      cadastroFiscal: model(),
      filaPendencia: model(),
      companyMonthlyCircular: model(),
      logDecisaoFatorR: model(),
      aliquotaSimplesNacional: model(),
      relatorioFaturamento: model(),
      company: model(),
    },
  };
});

const mockSimular = jest.fn();
const mockTransmitir = jest.fn();
const mockIndice = jest.fn();
jest.mock("../../../../fiscal/serpro/PgdasSimulacaoService.js", () => ({
  PgdasSimulacaoService: jest.fn().mockImplementation(() => ({ simular: mockSimular, transmitir: mockTransmitir })),
  parseRetornoSimulacao: jest.fn(),
}));
jest.mock("../../../../fiscal/serpro/SerproPgdasdService.js", () => ({ SerproPgdasdService: jest.fn().mockImplementation(() => ({consultarDeclaracaoIndice: mockIndice})) }));
jest.mock("../../../../fiscal/serpro/SerproRuntimeSettings.js", () => ({
  getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { hasCertificate: true, document: "11111111111111" } })),
}));
jest.mock("../RbtExtratoService.js", () => ({
  getRbt12: jest.fn(async () => ({ rbt12: 480000, origem: "teste", detalhePorMes: [] })),
  lerPeriodosAceitos: jest.fn(async () => null),
  gravarPeriodosAceitos: jest.fn(async () => null),
}));
jest.mock("../ApuracaoConfigMemoryService.js", () => ({
  lerConfigMemory: jest.fn(async () => null),
  salvarConfigMemory: jest.fn(async () => null),
  normalizarFormaAtividades: jest.fn((x) => x),
}));
jest.mock("../AtividadeResolver.js", () => ({ montarAtividadesDefault: jest.fn(), carregarAtividades: jest.fn() }));
jest.mock("../DisparidadeService.js", () => ({ detectarDisparidades: jest.fn(async () => []) }));
jest.mock("../FolhaDerivadaService.js", () => ({ derivarFolha12m: jest.fn(async () => null) }));
// A tabela de alíquotas é regra fiscal versionada e tem teste próprio — aqui só precisa devolver
// UMA faixa para o motor chegar até a escrita do snapshot.
jest.mock("../AliquotaResolver.js", () => ({
  resolverAliquota: jest.fn(async () => ({
    aliquotaNominal: 0.113, parcelaDeduzir: 22500, faixa: 3, vigenciaInicio: new Date("2018-01-01T00:00:00Z"),
  })),
  calcularAliquotaEfetiva: jest.fn(() => 0.0754),
  AliquotaResolverError: class extends Error {},
}));

jest.mock("../../../../guides/GuideLockService.js", () => ({ acquireGuideLease: jest.fn() }));
jest.mock("../RecuperacaoCalculo.js", () => ({ ...jest.requireActual("../RecuperacaoCalculo.js"), contextoOrigemCalculo: jest.fn() }));
jest.mock("../PeriodosRecusadosService.js", () => ({ executarComRetomada: jest.fn((run, params, { ajustarPeriodos }) => ajustarPeriodos(run, params)) }));
import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { calcularFechamento, salvarFechamento, transmitirFechamento, getDadosFechamento } from "../FechamentoService.js";
import { criarVinculoCalculo } from "../CalculoConfirmado.js";
import { contextoOrigemCalculo } from "../RecuperacaoCalculo.js";
import { acquireGuideLease } from "../../../../guides/GuideLockService.js";
import { montarAtividadesDefault } from "../AtividadeResolver.js";
const args = { portalClientId: "p1", competencia: "2026-10" };
const form = { atividades: [{ idAtividade: 1, valorInterno: 100, sujeitoFatorR: false }], folhaMensal12: [], regimeApuracao: "COMPETENCIA" };
const origem = { versao: 1, hash: "a".repeat(64), contribuinteCnpj: "12345678000190", regimeApuracao: "COMPETENCIA" };
const lease = { assertActive: jest.fn(), release: jest.fn(async () => {}) };
function snapshot(withContext = true) {
  const v = criarVinculoCalculo({ ...args, formulario: form, receitasBrutasAnteriores: [], folhasSalario: [], contribuinteCnpj: origem.contribuinteCnpj, contratanteCnpj: "11111111111111", ...(withContext ? { contextoOrigem: origem } : {}) });
  return { id: "s1", estado: "calculada", atividadesEscolhidas: form.atividades, folhaMensal12: [], idempotencyKey: v.calculoId, dasSimuladoSerpro: 6, rbt12: 100, simulacaoSerpro: { _portalCalculo: v } };
}
beforeEach(() => {
  jest.clearAllMocks();
  acquireGuideLease.mockResolvedValue(lease);
  contextoOrigemCalculo.mockResolvedValue(origem);
  prisma.portalClient.findUnique.mockResolvedValue({ cnpj: origem.contribuinteCnpj, razao: "Empresa", companyId: null });
  prisma.cadastroFiscal.findUnique.mockResolvedValue({ regimeApuracao: "COMPETENCIA" });
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(snapshot());
  prisma.portalInvoice.findMany.mockResolvedValue([]);
  montarAtividadesDefault.mockResolvedValue({ atividades: [{ idAtividade: 999, valorInterno: 999 }], semMapeamento: [] });
  mockSimular.mockResolvedValue({ dasValor: 6, raw: {} });
});
test("GET recupera formulário confirmado sem consulta paga nem trocar por default", async () => {
  const r = await getDadosFechamento(args);
  expect(r.calculoRecuperavel).toMatchObject({ dasValor: 6, formulario: form });
  expect(mockSimular).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
});
test("GET mantém legado readonly e valor salvo", async () => {
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(snapshot(false));
  const r = await getDadosFechamento(args);
  expect(r.calculoRecuperavel).toBeNull(); expect(r.calculoSalvo).toMatchObject({ dasValor: 6, formulario: form });
  expect(r.calculoSalvo).not.toHaveProperty("calculoId");
  expect(mockSimular).not.toHaveBeenCalled();
});
test("Calcular novamente com mesmos insumos reaproveita resultado sem simular", async () => {
  const r = await calcularFechamento({ ...args, ...form });
  expect(r).toMatchObject({ recuperado: true, dasValor: 6 });
  expect(mockSimular).not.toHaveBeenCalled(); expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  expect(lease.release).toHaveBeenCalled();
});
test("lease ocupada recusa antes de provedor e leitura de snapshot", async () => {
  acquireGuideLease.mockResolvedValueOnce(null);
  await expect(calcularFechamento({ ...args, ...form })).rejects.toMatchObject({ code: "CALCULO_EM_ANDAMENTO" });
  expect(mockSimular).not.toHaveBeenCalled(); expect(prisma.apuracaoSnapshot.findUnique).not.toHaveBeenCalled();
});
test.each([salvarFechamento, transmitirFechamento])("mudança na origem bloqueia ação antes de escrita/envio %#", async action => {
  const s = snapshot(); prisma.apuracaoSnapshot.findUnique.mockResolvedValue(s);
  contextoOrigemCalculo.mockResolvedValue({ ...origem, hash: "b".repeat(64) });
  await expect(action({ ...args, ...form, calculoId: s.idempotencyKey })).rejects.toMatchObject({ code: "CALCULO_DESATUALIZADO" });
  expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled();
});
test.each([salvarFechamento, transmitirFechamento])("token legado não contorna readonly pela API %#", async action => {
  const s = snapshot(false); prisma.apuracaoSnapshot.findUnique.mockResolvedValue(s);
  await expect(action({ ...args, ...form, calculoId: s.idempotencyKey })).rejects.toMatchObject({ code: "CALCULO_DESATUALIZADO" });
  expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
});
test("mudança de origem durante simulação não grava resultado novo", async () => {
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  contextoOrigemCalculo.mockResolvedValueOnce(origem).mockResolvedValueOnce({ ...origem, hash: "b".repeat(64) });
  await expect(calcularFechamento({ ...args, ...form })).rejects.toMatchObject({ code: "CALCULO_DESATUALIZADO" });
  expect(mockSimular).toHaveBeenCalledTimes(1); expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
  expect(lease.release).toHaveBeenCalled();
});

test("GET preserva valor salvo readonly se a conferência local ficar indisponível", async () => {
  contextoOrigemCalculo.mockRejectedValueOnce(new Error("banco indisponível"));
  const r = await getDadosFechamento(args);
  expect(r.calculoRecuperavel).toBeNull();
  expect(r.calculoSalvo).toMatchObject({ dasValor: 6, formulario: form });
  expect(r.calculoSalvo).not.toHaveProperty("calculoId");
  expect(mockSimular).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
});

test("salvar resultado confirmado e origem igual mantém token e fecha sem simular", async () => {
  const s = snapshot(); prisma.apuracaoSnapshot.findUnique.mockResolvedValue(s);
  const result = await salvarFechamento({ ...args, ...form, calculoId: s.idempotencyKey });
  expect(result.snapshot.estado).toBe("fechada");
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ idempotencyKey: s.idempotencyKey }), data: expect.objectContaining({ estado: "fechada" }) }));
  expect(mockSimular).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
});

test.each([null, undefined, NaN, Infinity, -1, "6"])("DAS inválido %s não substitui cálculo salvo", async dasValor => {
  const anterior = snapshot();
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(anterior);
  mockSimular.mockResolvedValueOnce({ dasValor });
  const alterado = { ...form, atividades: [{ ...form.atividades[0], valorInterno: 101 }] };
  await expect(calcularFechamento({ ...args, ...alterado })).rejects.toMatchObject({ code: "SIMULACAO_RESPOSTA_INVALIDA" });
  expect(mockSimular).toHaveBeenCalledTimes(1);
  expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
  expect((await getDadosFechamento(args)).calculoRecuperavel).toMatchObject({ dasValor: 6, formulario: form, calculoId: anterior.idempotencyKey });
  expect(mockTransmitir).not.toHaveBeenCalled();
  expect(lease.release).toHaveBeenCalled();
});

test.each([{ dados: "{" }, { dados: "{}" }, { dados: JSON.stringify({ valoresDevidos: [] }) }, { dados: JSON.stringify({ valoresDevidos: [{ valor: "inválido" }] }) }])("resposta HTTP200 malformada não grava cálculo: %j", async raw => {
  const { parseRetornoSimulacao } = jest.requireActual("../../../../fiscal/serpro/PgdasSimulacaoService.js");
  mockSimular.mockResolvedValueOnce(parseRetornoSimulacao(raw));
  await expect(calcularFechamento({ ...args, ...form, atividades: [{ ...form.atividades[0], valorInterno: 101 }] })).rejects.toMatchObject({ code: "SIMULACAO_RESPOSTA_INVALIDA" });
  expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
  expect((await getDadosFechamento(args)).calculoRecuperavel).toMatchObject({ dasValor: 6, formulario: form });
});

test("DAS zero numérico explícito permanece válido", async () => {
  mockSimular.mockResolvedValueOnce({ dasValor: 0 });
  const result = await calcularFechamento({ ...args, ...form, atividades: [{ ...form.atividades[0], valorInterno: 101 }] });
  expect(result).toMatchObject({ ok: true, dasValor: 0, snapshot: { estado: "calculada", dasSimuladoSerpro: 0 } });
  expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledTimes(1);
  expect(mockTransmitir).not.toHaveBeenCalled();
});
