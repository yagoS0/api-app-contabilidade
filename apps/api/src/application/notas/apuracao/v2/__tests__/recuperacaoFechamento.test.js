jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    aggregate: jest.fn(async () => ({ _sum: { total: 0 } })),
    count: jest.fn(async () => 0),
    upsert: jest.fn(async ({ create }) => create),
    create: jest.fn(async (args) => ({ id: "novo", ...(args?.data || {}) })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(async (args) => ({ id: "existente", ...(args?.data || {}) })),
  });
  return {
    prisma: {
      portalClient: model(),
      apuracaoPeriodoRecusado: model(),
      serproChamada: model(),
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
  buildDeclaracaoPayload: jest.requireActual("../../../../fiscal/serpro/PgdasSimulacaoService.js").buildDeclaracaoPayload,
}));
jest.mock("../../../../fiscal/serpro/SerproPgdasdService.js", () => ({ SerproPgdasdService: jest.fn().mockImplementation((options) => options?.client ? new (jest.requireActual("../../../../fiscal/serpro/SerproPgdasdService.js").SerproPgdasdService)(options) : ({consultarDeclaracaoIndice: mockIndice})) }));
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

jest.mock("../../../../operacoes/OperationsDocuments.js", () => ({ completarDocumentosOperacao: jest.fn(async () => ({ status: "documentos-ficticios" })) }));
jest.mock("../../../../guides/GuideLockService.js", () => ({ acquireGuideLease: jest.fn() }));
jest.mock("../RecuperacaoCalculo.js", () => ({ ...jest.requireActual("../RecuperacaoCalculo.js"), contextoOrigemCalculo: jest.fn() }));
jest.mock("../PeriodosRecusadosService.js", () => ({ ...jest.requireActual("../PeriodosRecusadosService.js"), executarComRetomada: jest.fn((run, params, { ajustarPeriodos }) => ajustarPeriodos(run, params)) }));
import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { calcularFechamento, salvarFechamento, transmitirFechamento, getDadosFechamento } from "../FechamentoService.js";
import { criarVinculoCalculo } from "../CalculoConfirmado.js";
import { contextoOrigemCalculo } from "../RecuperacaoCalculo.js";
import { acquireGuideLease } from "../../../../guides/GuideLockService.js";
import { montarAtividadesDefault } from "../AtividadeResolver.js";
import { executarCicloSimples } from '../CicloSimplesService.js';
import { getRbt12 } from '../RbtExtratoService.js';
import { getResolvedSerproCredentials } from '../../../../fiscal/serpro/SerproRuntimeSettings.js';
import * as automaticContext from '../../../../fiscal/automacaoCicloFiscalContext.js';
const args = { portalClientId: "p1", competencia: "2026-10" };
const form = { atividades: [{ idAtividade: 1, valorInterno: 100, sujeitoFatorR: false }], folhaMensal12: [], regimeApuracao: "COMPETENCIA" };
const origem = { versao: 1, hash: "a".repeat(64), contribuinteCnpj: "12345678000190", regimeApuracao: "COMPETENCIA" };
const lease = { assertActive: jest.fn(), release: jest.fn(async () => {}) };

test.each(['sucesso', 'base', 'selecao', 'recusa'])('R2A preparo real, snapshot e recusa antes de simulação: %s', async scenario => {
  const policy = jest.spyOn(automaticContext, 'conferirContextoCicloFiscal').mockResolvedValue({ version: 1 });
  try {
    prisma.portalClient.findUnique.mockResolvedValue({ id: 'p1', cnpj: origem.contribuinteCnpj, razao: 'Empresa', companyId: 'company-simples-ficticia' });
    prisma.company.findUnique.mockResolvedValue({ regimeTributario: 'SIMPLES', tipoTributario: null });
    prisma.cadastroFiscal.findUnique.mockResolvedValue({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501', usaFatorR: false, dataOpcaoSN: '2020-01-01' });
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
    prisma.portalInvoice.findMany.mockResolvedValue([{ total: 100, itens: [{ valor: 100, tipoReceita: 'SERVICO', flagExportacao: false }] }]);
    montarAtividadesDefault.mockResolvedValue({ atividades: [{ idAtividade: 1, valorInterno: 100, valorExterno: 0, sujeitoFatorR: false }], semMapeamento: [] });
    getRbt12.mockResolvedValue({ rbt12: 480000, origem: 'EXTRATO_PGDAS', detalhePorMes: [] });
    if (scenario === 'recusa') {
      getRbt12.mockResolvedValue({ rbt12: 480000, origem: 'EXTRATO_PGDAS', detalhePorMes: [{ pa: '2026-09', valorInterno: 10, valorExterno: 0 }] });
      mockSimular.mockRejectedValueOnce(Object.assign(new Error('Foi enviada receita bruta de um período desnecessário: 09/2026.'), { code: 'SERPRO_BUSINESS_ERROR', status: 400 }));
    }
    const rows = new Map([['ciclo_simples_config:p1', { enabled: true, fontes: ['NFSE'] }]]);
    if (['base', 'selecao'].includes(scenario)) getResolvedSerproCredentials.mockResolvedValueOnce({ certificate: { hasCertificate: true, document: '11111111111111' } }).mockImplementationOnce(async () => {
      if (scenario === 'base') contextoOrigemCalculo.mockResolvedValue({ ...origem, hash: 'b'.repeat(64) });
      else rows.set('ciclo_simples_config:p1', { enabled: false, fontes: ['NFSE'] });
      return { certificate: { hasCertificate: true, document: '11111111111111' } };
    });
    const db = { ...prisma, portalClient: prisma.portalClient, cadastroFiscal: prisma.cadastroFiscal, company: prisma.company,
      regimeHistorico: { findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async () => []), appSetting: {
        findUnique: async ({ where }) => rows.has(where.key) ? { value: rows.get(where.key) } : null,
        upsert: async ({ where, create, update }) => { const value = rows.has(where.key) ? update.value : create.value; rows.set(where.key, value); return { value }; },
      } };
    db.$transaction = run => run(db);
    prisma.$transaction = run => run(prisma);
    prisma.appSetting = db.appSetting;
    prisma.regimeHistorico = db.regimeHistorico;
    const result = await automaticContext.comAutomacaoCicloFiscal({ version: 0 }, () => automaticContext.comAutomacaoEmpresa('p1', () => executarCicloSimples({ ...args, scheduledAt: '2026-11-08T10:00:00Z' }, { db,
      now: () => new Date('2026-11-08T10:00:00Z'), conferir: automaticContext.conferirContextoCicloFiscal,
      coletarAdn: async () => ({ ok: true, complete: true, totalDocs: 1 }),
      getDados: getDadosFechamento, calcular: calcularFechamento, contexto: contextoOrigemCalculo,
    }), db), db);
    if (scenario === 'recusa') {
      expect(result).toMatchObject({ status: 'REVISAO_NECESSARIA', errorCode: 'RECEITAS_ANTERIORES_NAO_CONVERGIU' });
      expect(mockSimular).toHaveBeenCalledTimes(1);
      expect(prisma.apuracaoPeriodoRecusado.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ portalClientId: 'p1', competencia: '2026-10', lista: 'receitas', pa: '2026-09' }) }));
      expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
      expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
      expect(mockTransmitir).not.toHaveBeenCalled();
      return;
    }
    if (scenario !== 'sucesso') {
      expect(result).toMatchObject({ status: 'REVISAO_NECESSARIA', canRevise: true });
      expect(result.errorCode).toMatch(/^AUTOMACAO_EMPRESA_/);
      expect(mockSimular).not.toHaveBeenCalled();
      expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
      expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
      expect(mockTransmitir).not.toHaveBeenCalled();
      return;
    }
    expect(result.reason).toBe('Cálculo disponível para conferência do contador. Não houve transmissão.');
    expect(result).toMatchObject({ status: 'CALCULADO', calculo: { calculoId: expect.stringMatching(/^fech:auto:/), dasValor: '6' } });
    expect(prisma.apuracaoSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ portalClientId: 'p1', competencia: '2026-10', estado: 'calculada', dasSimuladoSerpro: 6 }) }));
    expect(mockSimular).toHaveBeenCalledTimes(1);
    expect(mockTransmitir).not.toHaveBeenCalled();
    expect(mockIndice).not.toHaveBeenCalled();
  } finally { policy.mockRestore(); }
});
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

// Complemento: documento criado pelo núcleo real, com sua tentativa persistida.
// Somente o transporte e os adaptadores de armazenamento são fictícios.
async function fixtureAutomaticoPersistido() {
  const policy = jest.spyOn(automaticContext, 'conferirContextoCicloFiscal').mockResolvedValue({ version: 1 });
  let current = null;
  const activities = [{ idAtividade: 1, valorInterno: 100, valorExterno: 0, sujeitoFatorR: false }];
  const rows = new Map([['ciclo_simples_config:p1', { enabled: true, fontes: ['NFSE'] }]]);
  prisma.portalClient.findUnique.mockResolvedValue({ id: 'p1', cnpj: origem.contribuinteCnpj, razao: 'Empresa', companyId: 'company-simples-ficticia' });
  prisma.company.findUnique.mockResolvedValue({ regimeTributario: 'SIMPLES', tipoTributario: null });
  prisma.cadastroFiscal.findUnique.mockResolvedValue({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501', usaFatorR: false, dataOpcaoSN: '2020-01-01' });
  prisma.portalInvoice.findMany.mockResolvedValue([{ total: 100, itens: [{ valor: 100, tipoReceita: 'SERVICO', flagExportacao: false }] }]);
  montarAtividadesDefault.mockResolvedValue({ atividades: activities, semMapeamento: [] });
  getRbt12.mockResolvedValue({ rbt12: 480000, origem: 'EXTRATO_PGDAS', detalhePorMes: [] });
  getResolvedSerproCredentials.mockResolvedValue({ certificate: { hasCertificate: true, document: '11111111111111' } });
  prisma.apuracaoSnapshot.findUnique.mockImplementation(async () => current);
  prisma.apuracaoSnapshot.create.mockImplementation(async ({ data }) => (current = { id: 'snapshot-auto-real', ...structuredClone(data) }));
  prisma.apuracaoSnapshot.updateMany.mockImplementation(async ({ where, data }) => {
    if (!current || where.id !== current.id || where.idempotencyKey && where.idempotencyKey !== current.idempotencyKey || where.estado && where.estado !== current.estado) return { count: 0 };
    current = { ...current, ...structuredClone(data) }; return { count: 1 };
  });
  prisma.apuracaoSnapshot.update.mockImplementation(async ({ data }) => (current = { ...current, ...structuredClone(data) }));
  prisma.regimeHistorico = { findMany: jest.fn(async () => []) };
  prisma.$queryRaw = jest.fn(async () => []);
  prisma.appSetting = {
    findUnique: jest.fn(async ({ where }) => rows.has(where.key) ? { value: structuredClone(rows.get(where.key)) } : null),
    upsert: jest.fn(async ({ where, create, update }) => { const value = structuredClone(rows.has(where.key) ? update.value : create.value); rows.set(where.key, value); return { value }; }),
  };
  prisma.$transaction = run => run(prisma);
  try {
    const result = await automaticContext.comAutomacaoCicloFiscal({ version: 0 }, () => automaticContext.comAutomacaoEmpresa('p1', () => executarCicloSimples({ ...args, scheduledAt: '2026-11-08T10:00:00Z' }, {
      db: prisma, now: () => new Date('2026-11-08T10:00:00Z'), conferir: automaticContext.conferirContextoCicloFiscal,
      coletarAdn: async () => ({ ok: true, complete: true, totalDocs: 1 }),
      getDados: getDadosFechamento, calcular: calcularFechamento, contexto: contextoOrigemCalculo,
    }), prisma), prisma);
    expect(result).toMatchObject({ status: 'CALCULADO', calculo: { calculoId: current?.idempotencyKey } });
    expect(current.simulacaoSerpro._portalCalculo).toMatchObject({ origemCalculo: 'AUTOMATICO_SIMPLES', preparacaoAutomatica: { versao: 1, attemptId: rows.get('ciclo_simples:p1:2026-10').token } });
    expect(mockSimular).toHaveBeenCalledTimes(1);
    return { rows, get snapshot() { return current; }, mutate: change => { current = change(structuredClone(current)); }, formulario: current.simulacaoSerpro._portalCalculo.formulario };
  } finally { policy.mockRestore(); }
}

test('snapshot automático íntegro percorre recuperação, confirmação e transmissão fictícia sem nova simulação', async () => {
  const fixture = await fixtureAutomaticoPersistido();
  const calculoId = fixture.snapshot.idempotencyKey;
  const recovered = await getDadosFechamento(args);
  expect(recovered.calculoRecuperavel).toMatchObject({ calculoId, formulario: fixture.formulario, dasValor: 6 });
  expect(mockSimular).toHaveBeenCalledTimes(1);
  expect(mockIndice).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
  const confirmed = await salvarFechamento({ ...args, ...fixture.formulario, calculoId, userId: 'contador-ficticio' });
  expect(confirmed.snapshot).toMatchObject({ estado: 'fechada', idempotencyKey: calculoId });
  expect(fixture.snapshot).toMatchObject({ estado: 'fechada', fechadaPor: 'contador-ficticio' });
  mockIndice.mockResolvedValue({ dados: [] });
  mockTransmitir.mockResolvedValue({ dasValor: 6, numeroDeclaracao: 'DECLARACAO-FICTICIA' });
  const delivered = await transmitirFechamento({ ...args, calculoId, userId: 'contador-ficticio', somenteDocumentosFaltantes: true });
  expect(delivered).toMatchObject({ ok: true, numeroDeclaracao: 'DECLARACAO-FICTICIA', snapshot: { estado: 'transmitida', idempotencyKey: calculoId } });
  expect(mockIndice).toHaveBeenCalledTimes(1);
  expect(mockTransmitir).toHaveBeenCalledTimes(1);
  expect(mockTransmitir).toHaveBeenCalledWith(expect.objectContaining({ atividades: fixture.formulario.atividades, competencia: args.competencia }));
  expect(mockSimular).toHaveBeenCalledTimes(1);
  expect(fixture.rows.get('ciclo_simples:p1:2026-10').calculo.calculoId).toBe(calculoId);
});

test.each(['removida', 'alterada', 'versao', 'insumo', 'tentativa'])('consumidores recusam prova automática %s preservando histórico e sem provedor', async scenario => {
  const fixture = await fixtureAutomaticoPersistido();
  const calculoId = fixture.snapshot.idempotencyKey;
  if (scenario === 'removida') fixture.mutate(s => { delete s.simulacaoSerpro._portalCalculo.preparacaoAutomatica; return s; });
  if (scenario === 'alterada') fixture.mutate(s => { s.simulacaoSerpro._portalCalculo.preparacaoAutomatica.prova.faturamento.total = 999; return s; });
  if (scenario === 'versao') fixture.mutate(s => { s.simulacaoSerpro._portalCalculo.preparacaoAutomatica.versao = 999; return s; });
  if (scenario === 'insumo') montarAtividadesDefault.mockResolvedValue({ atividades: fixture.formulario.atividades.map(a => ({ ...a, anexoImplicito: 'IV' })), semMapeamento: [] });
  if (scenario === 'tentativa') fixture.rows.get('ciclo_simples:p1:2026-10').token = 'outra-tentativa';
  const before = structuredClone(fixture.snapshot);
  expect((await getDadosFechamento(args)).calculoRecuperavel).toBeNull();
  await expect(salvarFechamento({ ...args, ...fixture.formulario, calculoId })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
  await expect(transmitirFechamento({ ...args, calculoId, somenteDocumentosFaltantes: true })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
  expect(fixture.snapshot).toMatchObject({ id: before.id, idempotencyKey: calculoId, estado: before.estado, atividadesEscolhidas: before.atividadesEscolhidas, simulacaoSerpro: { _portalCalculo: before.simulacaoSerpro._portalCalculo } });
  expect(fixture.snapshot.fechadaEm).toBeUndefined(); expect(fixture.snapshot.transmitidoEm).toBeUndefined();
  expect(mockSimular).toHaveBeenCalledTimes(1);
  expect(mockIndice).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
});
