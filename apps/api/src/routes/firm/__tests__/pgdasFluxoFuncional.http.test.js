import express from 'express';
import request from 'supertest';

let mockState;
const mockAccess = jest.fn(); const mockIndice = jest.fn(); const mockExtrato = jest.fn(); const mockGuia = jest.fn();
const mockTransmitir = jest.fn(); const mockCalcular = jest.fn(); const mockRead = jest.fn();
const mockTaskFind = jest.fn(); const mockTaskCreate = jest.fn(); const mockTaskUpdate = jest.fn();
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyFirmAccess: { findUnique: (...args) => mockAccess(...args) },
  portalClient: { findUnique: arg => { mockRead('company', arg); return Promise.resolve(arg.where.id === 'p' ? mockState.company : null); } },
  companyMonthlyCircular: { findUnique: arg => { mockRead('circular', arg); return Promise.resolve(mockState.circular); } },
  apuracaoSnapshot: { findUnique: arg => { mockRead('snapshot', arg); return Promise.resolve(mockState.snapshot); } },
  guide: { findFirst: arg => { mockRead('guide', arg); return Promise.resolve(mockState.guide); } },
  entregaObrigacaoArquivo: { findFirst: arg => { mockRead('externa', arg); return Promise.resolve(mockState.externa); } },
  appSetting: {
    findMany: async ({ where }) => Object.entries(mockState.indices).filter(([key]) => key.startsWith(where.key.startsWith)).map(([, value]) => ({ value })),
    createMany: async ({ data, skipDuplicates }) => { expect(skipDuplicates).toBe(true); for (const row of data) mockState.indices[row.key] ||= row.value; return { count: data.length }; },
    findUnique: async ({ where }) => ({ key: where.key, value: mockState.indices[where.key] }),
  },
  manualTask: { findUnique: (...args) => mockTaskFind(...args), create: (...args) => mockTaskCreate(...args), updateMany: (...args) => mockTaskUpdate(...args) },
} }));
jest.mock('../../../application/fiscal/serpro/SerproPgdasdService.js', () => ({ SerproPgdasdService: jest.fn(() => ({
  consultarDeclaracaoIndice: (...args) => mockIndice(...args), transmitirDeclaracao: (...args) => mockTransmitir(...args),
})) }));
jest.mock('../../../application/fiscal/serpro/SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: '00000000000200' } })) }));
jest.mock('../../../application/fiscal/serpro/SerproProcurationService.js', () => ({ SerproProcurationService: jest.fn(() => ({
  checkCompanyProcuration: jest.fn(async () => ({ status: 'ATIVA', systems: ['PGDAS-D'] })),
})) }));
jest.mock('../../../application/fiscal/serpro/SerproPgdasDeclaracaoService.js', () => ({ syncPgdasByCompetencia: (...args) => mockExtrato(...args) }));
jest.mock('../../../application/fiscal/serpro/CaptureSerproGuidesService.js', () => ({ capturePgdasGuideForCompany: (...args) => mockGuia(...args) }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn(() => { throw Error('REAL_TRANSPORT_FORBIDDEN'); }) }));
jest.mock('../../../application/notas/apuracao/v2/FechamentoService.js', () => ({
  getDadosFechamento: jest.fn(async () => ({ snapshot: mockState.snapshot })),
  transmitirFechamento: (...args) => mockTransmitir(...args), calcularFechamento: (...args) => mockCalcular(...args),
  FechamentoError: class extends Error {},
}));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createApuracaoV2Router } from '../apuracaoV2.js';
import { manualTasks, createManualTaskService } from '../../../application/tasks/ManualTaskService.js';
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';

const user = { id: 'u', role: 'contador', accountType: 'FIRM', status: 'active' };
const base = '/firm/companies/p/fechamento/2026-11';
const indice = { status: 200, dados: { periodo: { periodoApuracao: 202611, operacoes: [{ indiceDeclaracao: { numeroDeclaracao: 'EXTERNA-FICTICIA' } }] } } };
const negativo = { status: 200, dados: '', mensagens: [{ codigo: '[Aviso-PGDASD-MSG_ISN_027]', texto: 'Fixture sem declaração.' }] };
let tasks; let queue; let startSpy;
function app(ator = user) {
  const a = express(); a.use(express.json());
  a.use((req, res, next) => { if (ator) req.auth = { user: ator }; next(); });
  a.use('/firm/companies/:companyId', createApuracaoV2Router()); return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockState = { indices: {}, company: { id: 'p', cnpj: '00000000000100' }, circular: null, guide: null,
    snapshot: { id: 'snapshot-p', portalClientId: 'p', competencia: '2026-11', estado: 'calculada', idempotencyKey: 'calculo-local' },
    externa: { transmitidaEm: '2026-11-18T12:00:00Z' } };
  mockAccess.mockImplementation(async ({ where }) => where.companyId_userId.companyId === 'p' ? { role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] } : null);
  mockIndice.mockResolvedValue(indice);
  mockExtrato.mockImplementation(async args => {
    expect(args.somenteDocumentos).toBe(true); await args.validacaoDocumental.autorizar();
    mockState.circular = { portalClientId: 'p', competencia: '2026-11', pgdasNumeroDeclaracao: 'EXTERNA-FICTICIA',
      pgdasDeclaracaoFileId: 'declaracao-ficticia', pgdasReciboFileId: 'recibo-ficticio', dasTotal: 60 };
    return { circular: mockState.circular };
  });
  mockGuia.mockImplementation(async args => {
    expect(args.somenteDocumentos).toBe(true); await args.validacaoDocumental.autorizar();
    mockState.guide = { id: 'guia-ficticia', portalClientId: 'p', competencia: '2026-11', pdfBytes: Buffer.from('%PDF-synthetic'), valor: 60,
      extracted: { pgdasNumeroDeclaracao: args.validacaoDocumental.numeroDeclaracao },
      vencimento: new Date('2026-12-20T00:00:00Z'), paymentStatus: 'UNPAID' };
  });
  tasks = []; queue = [];
  mockTaskFind.mockImplementation(async ({ where }) => tasks.find(t => t.ownerId === where.ownerId_requestKey.ownerId && t.requestKey === where.ownerId_requestKey.requestKey) || null);
  mockTaskCreate.mockImplementation(async ({ data }) => { const task = { id: `task-${tasks.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }; tasks.push(task); return { ...task }; });
  mockTaskUpdate.mockImplementation(async ({ where, data }) => {
    const rows = tasks.filter(t => (!where.id || t.id === where.id) && (!where.status || t.status === where.status)
      && (!where.activeKey || t.activeKey === where.activeKey) && (!where.updatedAt?.lt || t.updatedAt < where.updatedAt.lt));
    rows.forEach(t => Object.assign(t, data)); return { count: rows.length };
  });
  const service = createManualTaskService({ db: prisma, schedule: fn => queue.push(fn) });
  startSpy = jest.spyOn(manualTasks, 'start').mockImplementation(service.start);
});
afterEach(() => {
  startSpy.mockRestore(); expect(mockTransmitir).not.toHaveBeenCalled(); expect(mockCalcular).not.toHaveBeenCalled();
  expect(SerproHttpClient).not.toHaveBeenCalled();
});

test.each([['sem sessão', null, 401], ['cliente', { ...user, accountType: 'CLIENT' }, 403]])('%s não alcança transporte', async (_label, ator, status) => {
  await request(app(ator)).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11' }).expect(status);
  expect(mockIndice).not.toHaveBeenCalled(); expect(mockExtrato).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled();
});
test.each([null, { role: 'ACCOUNTANT', status: 'REVOKED' }, { role: 'ACCOUNTANT', status: 'INACTIVE' }, { role: 'STAFF', status: 'ACTIVE' }])('vínculo %j recusa antes de consultar documentos', async link => {
  mockAccess.mockResolvedValue(link);
  await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11' }).expect(403);
  expect(mockRead).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled();
});
test('empresa diferente e confirmação de PA divergente não consultam', async () => {
  await request(app()).post(base.replace('/p/', '/outra/') + '/documentos').send({ confirmCompetencia: '2026-11' }).expect(403);
  await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-10' }).expect(400);
  expect(mockRead).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled();
});
test('empresa inexistente não retorna documentos de outro contexto', async () => {
  const r = await request(app({ ...user, role: 'admin' })).post(base.replace('/p/', '/inexistente/') + '/documentos').send({ confirmCompetencia: '2026-11' });
  expect(r.status).toBe(404); expect(r.body.ok).toBe(false); expect(mockIndice).not.toHaveBeenCalled();
});
test('recuperação e recarga preservam origem externa sem atribuir cálculo local; corpo não troca empresa/ator', async () => {
  const before = { ...mockState.snapshot };
  const r = await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11', portalClientId: 'outra', userId: 'forjado', competencia: '2027-01' }).expect(200);
  expect(r.body.result).toMatchObject({ origem: 'EXTERNA', completos: true, partial: false,
    documentos: { extrato: { estado: 'DISPONIVEL' }, guia: { estado: 'DISPONIVEL' } }, pagamento: { estado: 'NAO_CONFIRMADO' } });
  expect(mockIndice).toHaveBeenCalledWith({ contratanteCnpj: '00000000000200', contribuinteCnpj: '00000000000100', periodoApuracao: '2026-11' });
  expect(mockExtrato).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: 'p', competencia: '2026-11', somenteDocumentos: true,
    validacaoDocumental: expect.objectContaining({ numeroDeclaracao: 'EXTERNA-FICTICIA' }) }));
  expect(mockState.snapshot).toEqual(before);
  const reopened = await request(app()).get(base).expect(200);
  expect(reopened.body.dados.fluxoPgdas).toMatchObject({ origem: 'EXTERNA', completos: true });
  await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11' }).expect(200);
  expect(mockIndice).toHaveBeenCalledTimes(1); expect(mockExtrato).toHaveBeenCalledTimes(1); expect(mockGuia).toHaveBeenCalledTimes(1);
});
test('marcação externa sem índice oficial permanece pendente, sem DAS nem extrato', async () => {
  mockIndice.mockResolvedValue(negativo);
  const r = await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11' }).expect(200);
  expect(r.body.result).toMatchObject({ partial: true, consultaOficial: 'DECLARACAO_NAO_ENCONTRADA', transmissao: { confirmada: false } });
  expect(mockExtrato).not.toHaveBeenCalled(); expect(mockGuia).not.toHaveBeenCalled();
});
test('falha extrato interrompe DAS; falha DAS mantém declaração e extrato comprovados', async () => {
  mockExtrato.mockRejectedValueOnce(Object.assign(Error('synthetic failure'), { code: 'PGDAS_IDENTIDADE_DIVERGENTE' }));
  const first = await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11' }).expect(200);
  expect(first.body.result.partial).toBe(true); expect(mockGuia).not.toHaveBeenCalled();
  const reopened = await request(app()).get(base).expect(200);
  expect(reopened.body.dados.fluxoPgdas).toMatchObject({ origem: 'EXTERNA', partial: true, transmissao: { confirmada: true }, documentos: { extrato: { ok: false }, guia: { ok: false } } });
  mockGuia.mockRejectedValueOnce(Object.assign(Error('synthetic missing DAS'), { code: 'SERPRO_PGDASD_PDF_NOT_FOUND' }));
  const second = await request(app()).post(`${base}/documentos`).send({ confirmCompetencia: '2026-11' }).expect(200);
  expect(second.body.result).toMatchObject({ partial: true, transmissao: { confirmada: true }, documentos: { extrato: { ok: true }, guia: { ok: false } } });
  expect(mockState.snapshot.estado).toBe('calculada');
});
test('resultado parcial assíncrono e replay usam a mesma tarefa, sem duplicar consulta', async () => {
  mockGuia.mockRejectedValueOnce(Error('synthetic unavailable'));
  const key = 'pgdas-documentos-request-001'; const a = app();
  const first = await request(a).post(`${base}/documentos`).set('Prefer', 'respond-async').set('Idempotency-Key', key).send({ confirmCompetencia: '2026-11' }).expect(202);
  expect(mockIndice).not.toHaveBeenCalled(); expect(queue).toHaveLength(1);
  await queue[0]();
  expect(tasks[0]).toMatchObject({ status: 'partial', responseStatus: 200, result: { result: { partial: true } } });
  const replay = await request(a).post(`${base}/documentos`).set('Prefer', 'respond-async').set('Idempotency-Key', key).send({ confirmCompetencia: '2026-11' }).expect(202);
  expect(replay.body.taskId).toBe(first.body.taskId); expect(queue).toHaveLength(1); expect(mockIndice).toHaveBeenCalledTimes(1);
});
test('revogação entre aceite e execução assíncrona recusa antes de qualquer leitura ou transporte', async () => {
  await request(app()).post(`${base}/documentos`).set('Prefer', 'respond-async').set('Idempotency-Key', 'pgdas-documentos-request-002').send({ confirmCompetencia: '2026-11' }).expect(202);
  mockAccess.mockResolvedValue({ role: 'ACCOUNTANT', status: 'REVOKED' });
  await queue[0]();
  expect(tasks[0]).toMatchObject({ status: 'error', responseStatus: 403 });
  expect(mockRead).not.toHaveBeenCalled(); expect(mockIndice).not.toHaveBeenCalled();
});
