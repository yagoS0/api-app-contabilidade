// B3/B3.2: a base permitia despachos nos quatro PAs. B3.2 fecha essa lacuna
// somente a partir de 11/2026; preserva recuperação e protocolos históricos.
// Doubles isolam banco, credenciais, armazenamento e transporte; nenhum endpoint externo é usado.
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
jest.mock('../../../../../composition/fs12DoCalculo.js', () => ({
  validarFs12ParaNovoCalculo: jest.fn(async () => { throw Object.assign(new Error('Confirme a FS12 na Apuração.'), { code: 'FS12_AUSENTE', status: 409 }); }),
  validarUsoFs12DoCalculo: jest.fn(async () => { throw Object.assign(new Error('Uso não comprovado.'), { code: 'FS12_CALCULO_SEM_VINCULO', status: 409 }); }),
}));
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
import { calcularFechamento, salvarFechamento, transmitirFechamento } from "../FechamentoService.js";
import { criarVinculoCalculo } from "../CalculoConfirmado.js";
import { contextoOrigemCalculo } from "../RecuperacaoCalculo.js";
import { acquireGuideLease } from "../../../../guides/GuideLockService.js";
import { montarAtividadesDefault } from "../AtividadeResolver.js";
import { executarCicloSimples } from '../CicloSimplesService.js';
const PERIODOS = ['2026-10', '2026-11', '2026-12', '2027-01'];
const origem = { versao: 1, hash: 'a'.repeat(64), contribuinteCnpj: '12345678000190', regimeApuracao: 'COMPETENCIA' };
const formulario = { atividades: [{ idAtividade: 1, valorInterno: 100, valorExterno: 0, sujeitoFatorR: false }], folhaMensal12: [], regimeApuracao: 'COMPETENCIA' };
const lease = { assertActive: jest.fn(), release: jest.fn(async () => {}) };
const clone = value => JSON.parse(JSON.stringify(value));
const contexto = competencia => ({ portalClientId: 'empresa-sintetica', competencia });
function snapshot(competencia, estado = 'calculada') {
  const vinculo = criarVinculoCalculo({ ...contexto(competencia), formulario, receitasBrutasAnteriores: [], folhasSalario: [], contribuinteCnpj: origem.contribuinteCnpj, contratanteCnpj: '11111111111111', contextoOrigem: origem });
  return { id: 'snapshot-sintetico', estado, atividadesEscolhidas: clone(formulario.atividades), folhaMensal12: [], idempotencyKey: vinculo.calculoId, dasSimuladoSerpro: 6, rbt12: 100, simulacaoSerpro: { _portalCalculo: vinculo } };
}
beforeEach(() => {
  jest.clearAllMocks();
  acquireGuideLease.mockResolvedValue(lease);
  contextoOrigemCalculo.mockResolvedValue(origem);
  prisma.portalClient.findUnique.mockResolvedValue({ id: 'empresa-sintetica', cnpj: origem.contribuinteCnpj, razao: 'Empresa sintética', companyId: null });
  prisma.cadastroFiscal.findUnique.mockResolvedValue({ regimeApuracao: 'COMPETENCIA' });
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  prisma.apuracaoSnapshot.updateMany.mockResolvedValue({ count: 1 });
  prisma.portalInvoice.findMany.mockResolvedValue([]);
  montarAtividadesDefault.mockResolvedValue({ atividades: formulario.atividades, semMapeamento: [] });
  mockIndice.mockResolvedValue({ dados: [] });
  mockSimular.mockResolvedValue({ dasValor: 6, raw: {} });
  mockTransmitir.mockResolvedValue({ dasValor: 6, numeroDeclaracao: 'FICTICIA-B3', indicadorTransmissao: true,
    desfecho: { confirmada: true, evidencia: { origem: 'ALTAN', numeroDeclaracao: 'FICTICIA-B3' } } });
});

describe('B3 — fronteira manual atual: lacunas não são critérios tributários aprovados', () => {
  test.each(PERIODOS.flatMap(pa => [false, true].map(fatorR => [pa, fatorR])))('%s / Fator R %s: seleção legada depende da atividade, não do PA', async (competencia, sujeitoFatorR) => {
    const anterior = new Date(`${competencia}-01T00:00:00Z`); anterior.setUTCMonth(anterior.getUTCMonth() - 1);
    const folhas = [{ pa: anterior.toISOString().slice(0, 7), valor: 0, origem: 'NAVEGADOR_NAO_COMPROVADO', conferidoPor: 'alegado-pelo-cliente' }];
    const stop = Object.assign(new Error('DOUBLE: interrompe antes de persistir'), { code: 'B3_TEST_STOP' });
    mockSimular.mockRejectedValueOnce(stop);
    const result = calcularFechamento({ ...contexto(competencia), ...formulario, atividades: [{ ...formulario.atividades[0], sujeitoFatorR }], folhaMensal12: folhas });
    if (competencia >= '2026-11') {
      await expect(result).rejects.toMatchObject({ code: competencia >= '2027-01' ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_AUSENTE' });
      expect(mockSimular).not.toHaveBeenCalled();
      expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
      expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
      expect(lease.release).toHaveBeenCalledTimes(1);
      return;
    }
    await expect(result).rejects.toBe(stop);
    expect(mockSimular).toHaveBeenCalledTimes(1);
    expect(mockSimular.mock.calls[0][0].folhasSalario).toEqual(sujeitoFatorR ? [{ pa: folhas[0].pa, valor: 0 }] : []);
    expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
    expect(mockTransmitir).not.toHaveBeenCalled();
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  test.each(PERIODOS)('%s: cálculo íntegro legado sem evidência mensal ainda pode ser recuperado e fechado', async competencia => {
    const saved = snapshot(competencia), before = clone(saved);
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(saved);
    const recuperado = await calcularFechamento({ ...contexto(competencia), ...formulario });
    expect(recuperado).toMatchObject({ recuperado: true, calculoId: saved.idempotencyKey, formulario });
    expect(mockSimular).not.toHaveBeenCalled();
    const fechamento = salvarFechamento({ ...contexto(competencia), ...formulario, userId: 'contador-sintetico', calculoId: saved.idempotencyKey });
    if (competencia >= '2026-11') {
      await expect(fechamento).rejects.toMatchObject({ code: competencia >= '2027-01' ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_CALCULO_SEM_VINCULO' });
      expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
      expect(saved).toEqual(before);
      return;
    }
    const fechado = await fechamento;
    expect(fechado.snapshot).toMatchObject({ estado: 'fechada', idempotencyKey: saved.idempotencyKey });
    expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledTimes(1);
    expect(saved).toEqual(before);
    expect(mockTransmitir).not.toHaveBeenCalled();
  });

  test.each(PERIODOS)('%s: transmissão fictícia de token legado não verifica conferência mensal FS12', async competencia => {
    const saved = snapshot(competencia, 'fechada');
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(saved);
    const result = transmitirFechamento({ ...contexto(competencia), calculoId: saved.idempotencyKey, userId: 'contador-sintetico', somenteDocumentosFaltantes: true });
    if (competencia >= '2026-11') {
      await expect(result).rejects.toMatchObject({ code: competencia >= '2027-01' ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE' });
      expect(mockIndice).toHaveBeenCalledTimes(1);
      expect(mockTransmitir).not.toHaveBeenCalled();
      expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: 'fechada' }) }));
      return;
    }
    await expect(result).resolves.toMatchObject({ ok: true, numeroDeclaracao: 'FICTICIA-B3' });
    expect(mockIndice).toHaveBeenCalledTimes(1);
    expect(mockTransmitir).toHaveBeenCalledTimes(1);
    expect(mockTransmitir).toHaveBeenCalledWith(expect.objectContaining({ competencia, folhasSalario: [], tipoDeclaracao: 1 }));
    expect(mockSimular).not.toHaveBeenCalled();
  });

  test.each(['transmitindo', 'erro_transmissao'])('estado %s prevalece: calcular, salvar e transmitir não repetem despacho', async estado => {
    const saved = snapshot('2026-11', estado), before = clone(saved);
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(saved);
    const args = { ...contexto('2026-11'), ...formulario, calculoId: saved.idempotencyKey };
    await expect(calcularFechamento(args)).rejects.toMatchObject({ code: 'TRANSMISSAO_PENDENTE_CONFERENCIA' });
    await expect(salvarFechamento(args)).rejects.toMatchObject({ code: 'TRANSMISSAO_PENDENTE_CONFERENCIA' });
    await expect(transmitirFechamento(args)).rejects.toMatchObject({ code: 'TRANSMISSAO_PENDENTE_CONFERENCIA' });
    expect(mockSimular).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled(); expect(saved).toEqual(before);
  });

  test('declaração transmitida permanece histórica: não recalcula nem retransmite por reutilizar o token', async () => {
    const saved = snapshot('2026-12', 'transmitida');
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(saved);
    await expect(calcularFechamento({ ...contexto('2026-12'), ...formulario })).rejects.toMatchObject({ code: 'ESTADO_INVALIDO' });
    await expect(transmitirFechamento({ ...contexto('2026-12'), calculoId: saved.idempotencyKey })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
    expect(mockSimular).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  });

  test('empresa divergente ou token alterado recusa antes do índice e do transporte', async () => {
    const saved = snapshot('2026-11'); prisma.apuracaoSnapshot.findUnique.mockResolvedValue(saved);
    await expect(transmitirFechamento({ portalClientId: 'outra-empresa', competencia: '2026-11', calculoId: saved.idempotencyKey })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
    await expect(transmitirFechamento({ ...contexto('2026-11'), calculoId: `${saved.idempotencyKey}alterado` })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
    expect(mockIndice).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled(); expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
  });
});

// Fixture da coordenação automática: executa CicloSimples/PreparacaoAutomatica reais;
// transporte/calcular e banco são doubles. Não comprova atomicidade PostgreSQL.
function automatico(competencia) {
  const args = contexto(competencia);
  const next = new Date(`${competencia}-08T10:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  args.scheduledAt = next.toISOString();
  const rows = new Map([['ciclo_simples_config:empresa-sintetica', { enabled: true, fontes: ['NFSE'] }]]);
  const db = {
    appSetting: {
      findUnique: jest.fn(async ({ where }) => rows.has(where.key) ? { value: clone(rows.get(where.key)) } : null),
      upsert: jest.fn(async ({ where, create, update }) => { const value = clone(rows.has(where.key) ? update.value : create.value); rows.set(where.key, value); return { value }; }),
      create: jest.fn(async ({ data }) => { rows.set(data.key, clone(data.value)); return data; }),
    },
    portalClient: { findUnique: jest.fn(async () => ({ id: args.portalClientId, cnpj: origem.contribuinteCnpj, status: 'ACTIVE', companyId: 'company-sintetica' })) },
    cadastroFiscal: { findUnique: jest.fn(async () => ({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501', usaFatorR: false, dataOpcaoSN: '2020-01-01' })) },
    regimeHistorico: { findMany: jest.fn(async () => []) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: 'SIMPLES' })) },
    apuracaoPeriodoRecusado: { findMany: jest.fn(async () => []) },
    serproChamada: { findFirst: jest.fn(async () => null) },
    user: { findUnique: jest.fn(async () => ({ status: 'active', role: 'user', accountType: 'FIRM' })) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    $queryRaw: jest.fn(async () => []),
  };
  db.$transaction = run => run(db);
  const dados = { estado: 'aberta', rbtPreparado: { rbt12: 480000, origem: 'EXTRATO_PGDAS', detalhePorMes: [] }, rbt12: 480000, rbt12Origem: 'EXTRATO_PGDAS', origemAtividades: 'notas', semClassificacao: 0, atividades: clone(formulario.atividades), faturamento: { total: 100 }, disparidades: [], folhaMensal12: [{ pa: competencia, valor: 999 }] };
  const deps = { db, now: () => next, resolverIdentidade: async () => ({ contratanteCnpj: '11111111111111', contribuinteCnpj: origem.contribuinteCnpj }), envolverTentativa: (_args, run) => run(), conferir: jest.fn(async () => ({ version: 1 })), contexto: jest.fn(async () => origem), coletarAdn: jest.fn(async () => ({ ok: true, complete: true })), getDados: jest.fn(async () => dados), calcular: jest.fn(async () => ({ ok: true, calculoId: 'calc-sintetico', dasValor: 6 })) };
  return { args, deps, dados, rows };
}

describe('B3 — coordenação automática atual, sem habilitação fiscal nova', () => {
  test.each(PERIODOS)('%s: sem Fator R ainda prepara folha vazia; repetição não recalcula', async competencia => {
    const f = automatico(competencia);
    if (competencia >= '2026-11') {
      await expect(executarCicloSimples(f.args, f.deps)).rejects.toMatchObject({ code: competencia >= '2027-01' ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE' });
      expect(f.deps.calcular).not.toHaveBeenCalled();
      expect(f.deps.coletarAdn).not.toHaveBeenCalled();
      expect(f.deps.db.appSetting.upsert).not.toHaveBeenCalled();
      return;
    }
    const result = await executarCicloSimples(f.args, f.deps);
    expect(result).toMatchObject({ status: 'CALCULADO' });
    expect(f.deps.calcular).toHaveBeenCalledWith(expect.objectContaining({ ...contexto(competencia), folhaMensal12: [] }));
    await executarCicloSimples(f.args, f.deps);
    expect(f.deps.calcular).toHaveBeenCalledTimes(1);
    expect(mockSimular).not.toHaveBeenCalled(); expect(mockTransmitir).not.toHaveBeenCalled();
  });
  test.each(PERIODOS)('%s: Fator R exige conferência e não promove folha sugerida à prova', async competencia => {
    const f = automatico(competencia); f.dados.atividades[0].sujeitoFatorR = true;
    if (competencia >= '2026-11') {
      await expect(executarCicloSimples(f.args, f.deps)).rejects.toMatchObject({ code: competencia >= '2027-01' ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE' });
      expect(f.deps.calcular).not.toHaveBeenCalled();
      return;
    }
    expect(await executarCicloSimples(f.args, f.deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', errorCode: 'CICLO_FATOR_R_CONFERENCIA' });
    expect(f.deps.calcular).not.toHaveBeenCalled();
  });
  test('timeout após reserva continua incerto após reinício, sem repetir cálculo', async () => {
    const f = automatico('2026-10');
    f.deps.calcular.mockRejectedValueOnce(Object.assign(new Error('Timeout sintético'), { code: 'TIMEOUT' }));
    expect(await executarCicloSimples(f.args, f.deps)).toMatchObject({ status: 'INCERTO', canRevise: false });
    expect(await executarCicloSimples(f.args, f.deps)).toMatchObject({ status: 'INCERTO' });
    expect(f.deps.calcular).toHaveBeenCalledTimes(1);
    expect(f.deps.coletarAdn).toHaveBeenCalledTimes(1);
  });
});
