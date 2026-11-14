jest.mock('../../operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn() }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../fiscal/serpro/CompanyAutomationService.js', () => ({ lerAutomacaoEmpresa: jest.fn() }));
jest.mock('../guideCompliance.js', () => ({ computeGuideComplianceMap: jest.fn() }));
jest.mock('../../whatsapp/ContatoWhatsappService.js', () => ({ destinatariosDeEnvio: jest.fn() }));
jest.mock('../../whatsapp/EnvioGuiaWhatsappService.js', () => ({ carregarCanal: jest.fn(), enviarGuiaPorWhatsapp: jest.fn() }));
jest.mock('../GuideCompanyEmailService.js', () => ({ enviarGuiasExatasDoCiclo: jest.fn() }));

import { lerInssManual } from '../../operacoes/OperationsManualInss.js';
import { lerAutomacaoEmpresa } from '../../fiscal/serpro/CompanyAutomationService.js';
import { createCicloEnvioGuiasService, revisaoDocumentoEnvio } from '../CicloEnvioGuiasService.js';

// Golden outputs captured before extraction on 3a1b82b254ef9b8a3c9f3fd99df839a1ba5a025f.
// Dependencies record actual call order; no replica of selection or projection rules.
const time = '2026-11-13T11:00:00.000Z';
const input = { portalClientId: 'a', competencia: '2026-10' };
const serializable = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const trace = [];
  const read = (name, fn) => jest.fn(async (...args) => {
    trace.push({ operation: name, args: serializable(args) });
    return fn(...args);
  });
  const settings = new Map([
    ['operations_manual_inss:v1:a:2026-10', { fixture: true }],
    ['envio_guias_config:a', { enabled: true, selectionToken: 'v1' }],
    ['serpro_runtime_settings', { rotinas: { simples_envio_guias: { enabled: true, frequency: 'DAILY', hour: 8 } } }],
  ]);
  const guides = [{ id: 'g', portalClientId: 'a', competencia: '2026-10', tipo: 'SIMPLES', status: 'PROCESSED',
    valor: '100', hash: 'hash', pdfBytes: Buffer.from('%PDF-sintetico'), vencimento: new Date('2026-11-20T00:00:00Z'),
    updatedAt: new Date(time), paymentStatus: 'PENDING', emailStatus: 'PENDING', liberadaCliente: false }];
  const destinations = { emails: ['contador@example.test'], telefones: [] };
  const projection = { das: { required: true, ok: true }, inss: { required: false, ok: true },
    parcDas: { required: false, ok: true }, guiasParcelamentoMes: [], expectativaParcelamentoInconclusiva: false };
  const portal = { id: 'a', companyId: 'legacy', status: 'ATIVA', temFolha: false, hasProlabore: false };
  const history = [{ regime: 'SIMPLES', vigenciaInicio: '2020-01-01', vigenciaFim: null }];
  const ledger = [];
  const automation = { automationPolicy: { paused: false }, globalAutomationPolicy: { paused: false } };
  const writes = [jest.fn(), jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  const db = {
    portalClient: { findUnique: read('portalClient.findUnique', () => portal) },
    company: { findUnique: read('company.findUnique', () => ({ regimeTributario: 'SIMPLES' })) },
    regimeHistorico: { findMany: read('regimeHistorico.findMany', () => history) },
    feriado: { findMany: read('feriado.findMany', () => []) },
    guide: { findMany: read('guide.findMany', ({ where }) => guides.filter(g => g.portalClientId === where.portalClientId && g.competencia === where.competencia)), updateMany: writes[0] },
    envioGuia: { findMany: read('envioGuia.findMany', () => ledger) },
    appSetting: { findUnique: read('appSetting.findUnique', ({ where }) => settings.has(where.key) ? { key: where.key, value: structuredClone(settings.get(where.key)) } : null),
      upsert: writes[1], updateMany: writes[2], update: writes[3] },
    $transaction: writes[4],
  };
  lerAutomacaoEmpresa.mockImplementation(async (client, company) => {
    expect(client).toBe(db);
    trace.push({ operation: 'lerAutomacaoEmpresa', args: [company] });
    return automation;
  });
  lerInssManual.mockImplementation(async (client, company, competencia) => {
    expect(client).toBe(db);
    trace.push({ operation: 'lerInssManual', args: [company, competencia] });
    return { applicabilitySource: 'month', changedBy: 'contador-ficticio', changedAt: time, applicable: false, status: 'NOT_APPLICABLE' };
  });
  const deps = { db, now: jest.fn(() => { trace.push({ operation: 'now', value: time }); return new Date(time); }),
    compliance: read('compliance', () => new Map([['a', projection]])), contatos: read('contatos', () => destinations),
    canal: read('canal', () => ({ disponivel: false })), email: jest.fn(), whatsapp: jest.fn() };
  const service = createCicloEnvioGuiasService(deps);
  const attempt = (status = 'SENT', revision = revisaoDocumentoEnvio(guides[0])) => settings.set('envio_guias_ciclo:a:2026-10', {
    portalClientId: 'a', competencia: '2026-10', revision: 2, warnings: [],
    attempts: [{ id: 'tentativa-1', guideId: 'g', channel: 'EMAIL', destination: destinations.emails[0], documentRevision: revision, status }],
  });
  const assertReadOnly = () => [...writes, deps.email, deps.whatsapp].forEach(fn => expect(fn).not.toHaveBeenCalled());
  return { service, db, trace, deps, guides, destinations, projection, portal, history, ledger, settings, automation, attempt, assertReadOnly };
}

beforeEach(() => jest.clearAllMocks());

test.each([
  ['guia não liberada', () => {}],
  ['guia liberada', f => { f.guides[0].liberadaCliente = true; }],
  ['guia paga', f => { f.guides[0].paymentStatus = 'PAID'; }],
  ['documento substituído após tentativa', f => { f.attempt(); f.guides[0].hash = 'revisao-substituida'; }],
  ['envio confirmado', f => f.attempt()],
  ['resultado indeterminado', f => f.attempt('UNCERTAIN')],
  ['recibo tardio de falha após aceite', f => { f.attempt(); f.ledger.push({ guideId: 'g', canal: 'EMAIL', destino: 'contador@example.test', status: 'falhou' }); }],
  ['ledger indeterminado após aceite', f => { f.attempt(); f.ledger.push({ guideId: 'g', canal: 'EMAIL', destino: 'contador@example.test', status: 'indeterminado' }); }],
  ['pausa da empresa', f => { f.automation.automationPolicy.paused = true; }],
  ['pausa global', f => { f.automation.globalAutomationPolicy.paused = true; }],
  ['agenda desligada', f => { f.settings.get('serpro_runtime_settings').rotinas.simples_envio_guias.enabled = false; }],
  ['configuração ausente', f => f.settings.delete('envio_guias_config:a')],
  ['documento ausente', f => { f.guides.length = 0; f.projection.das.ok = false; }],
  ['histórico ausente', f => { f.history.length = 0; }],
  ['comprovante externo sem tentativa atual', f => { f.ledger.push({ guideId: 'g', canal: 'EXTERNO', status: 'entregue' }); }],
  ['WhatsApp indisponível', f => { f.destinations.telefones.push({ telefoneE164: '+5521999990000' }); }],
])('preserva DTO integral e sequência de leitura: %s', async (_name, arrange) => {
  const f = fixture();
  arrange(f);
  const dto = await f.service.ler(input);
  expect(serializable(dto)).toMatchSnapshot('DTO legado');
  expect(f.trace).toMatchSnapshot('ordem das consultas e relógio');
  f.assertReadOnly();
});

test('leitura repetida preserva o resultado e não reserva nem duplica efeitos', async () => {
  const f = fixture();
  expect(await f.service.ler(input)).toEqual(await f.service.ler(input));
  f.assertReadOnly();
});

test('consulta por empresa e competência não incorpora guia de outro escopo', async () => {
  const f = fixture();
  f.guides.push({ ...f.guides[0], id: 'outra-empresa', portalClientId: 'b' }, { ...f.guides[0], id: 'outro-mes', competencia: '2026-09' });
  const dto = await f.service.ler(input);
  expect(dto.items.map(item => item.guideId)).toEqual(['g']);
  expect(f.db.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: input }));
  expect(f.db.regimeHistorico.findMany).toHaveBeenCalledWith({ where: { companyId: 'legacy' } });
  expect(f.db.envioGuia.findMany).toHaveBeenCalledWith({ where: { guideId: { in: ['g'] } } });
  f.assertReadOnly();
});

test.each([
  ['entrada inválida', () => {}, { portalClientId: 'a', competencia: '2026-13' }],
  ['empresa inativa', f => { f.portal.status = 'INATIVA'; }, input],
  ['empresa ausente', f => { f.db.portalClient.findUnique.mockResolvedValue(null); }, input],
  ['falha na consulta', f => { f.db.guide.findMany.mockRejectedValue(Object.assign(new Error('consulta indisponível'), { code: 'TEST_QUERY_ERROR' })); }, input],
])('preserva erro sem efeitos: %s', async (_name, arrange, args) => {
  const f = fixture();
  arrange(f);
  let failure;
  try { await f.service.ler(args); } catch (error) { failure = { message: error.message, code: error.code, status: error.status }; }
  expect(failure).toBeDefined();
  expect({ failure, trace: f.trace }).toMatchSnapshot();
  f.assertReadOnly();
});
