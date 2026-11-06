// Executar somente com PostgreSQL descartável explicitamente fornecido pelo Principal.
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../../../../infrastructure/db/prisma.js';
import { assertDisposablePostgres } from '../../../../../test-support/disposablePostgresGuard.js';
jest.mock('../../../CertResolver.js', () => ({ SERVICOS: { NFSE: 'NFSE' }, resolveCertForCompany: jest.fn() }));
jest.mock('../../../adn-nacional/AdnNacionalClient.js', () => ({ fetchDfeNFSe: jest.fn() }));
jest.mock('../../../../nfse/AdnXmlMetadata.js', () => ({ parseXmlMetadata: jest.fn(), parseNfseEvento: jest.fn() }));
jest.mock('../../../pendenciasDoPeriodo.js', () => {
  const actual = jest.requireActual('../../../pendenciasDoPeriodo.js');
  return { ...actual, registrarPendenciaDoPeriodo: jest.fn(actual.registrarPendenciaDoPeriodo) };
});
import { resolveCertForCompany } from '../../../CertResolver.js';
import { fetchDfeNFSe } from '../../../adn-nacional/AdnNacionalClient.js';
import { parseXmlMetadata } from '../../../../nfse/AdnXmlMetadata.js';
import { registrarPendenciaDoPeriodo } from '../../../pendenciasDoPeriodo.js';
import { conferirCompetencia } from '../ConferenciaAdnService.js';
const url = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== url ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !/^\/[a-zA-Z0-9_]+_governance_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Banco descartável obrigatório');
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
jest.setTimeout(30000);
(url ? describe : describe.skip)('conferência ADN — atomicidade PostgreSQL e duas sessões', () => {
  let second, portalClientId, snap, nota;
  const competencia = '2026-10';
  const args = () => ({ portalClientId, competencia });
  const readSnap = () => prisma.apuracaoSnapshot.findUnique({ where: { id: snap.id } });
  const readNota = () => prisma.portalInvoice.findUnique({ where: { id: nota.id } });
  const batch = () => ({ status: 'DOCUMENTOS_LOCALIZADOS', items: [{ NSU: '1', TipoDocumento: 'NFSE', ArquivoXml: Buffer.from('<sintetico/>').toString('base64') }] });
  beforeAll(async () => {
    const actual = await prisma.$queryRaw`SELECT current_database() AS name, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('server_version_num') AS "versionNumber"`;
    assertDisposablePostgres({ raw: url, actual: actual[0] });
    second = new PrismaClient({ datasources: { db: { url } } });
  });
  beforeEach(async () => {
    portalClientId = randomUUID();
    await prisma.portalClient.create({ data: { id: portalClientId, cnpj: '53742042000164', razao: 'ADN CONCORRENCIA SINTETICA' } });
    snap = await prisma.apuracaoSnapshot.create({ data: { portalClientId, competencia, rbt12: 0,
      receitaPorTipo: {}, idempotencyKey: randomUUID(), estado: 'calculada', conferenciaStatus: null, conferenciaResultado: Prisma.DbNull } });
    nota = await prisma.portalInvoice.create({ data: { clientId: portalClientId, type: 'NFSE', papel: 'EMIT', status: 'EMITIDA',
      statusEfetivo: 'autorizada', chaveAcesso: randomUUID(), competencia: new Date('2026-10-01'), total: 25 } });
    resolveCertForCompany.mockResolvedValue({ source: 'company_a1', pfxBuffer: Buffer.from('SINTETICO'), password: 'SINTETICA' });
    parseXmlMetadata.mockReturnValue({ chaveAcesso: nota.chaveAcesso, competencia: '2026-10-01', cnpjPrestador: '53742042000164', situacao: 'CANCELADA' });
    fetchDfeNFSe.mockReset().mockResolvedValue(batch());
    registrarPendenciaDoPeriodo.mockImplementation(jest.requireActual('../../../pendenciasDoPeriodo.js').registrarPendenciaDoPeriodo);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.pendenciaPosFechamento.deleteMany({ where: { portalClientId } });
    await prisma.portalClient.deleteMany({ where: { id: portalClientId, razao: 'ADN CONCORRENCIA SINTETICA' } });
  });
  afterAll(async () => { await second?.$disconnect(); await prisma.$disconnect(); });
  test.each(['divergente', 'nao_conferivel'])('sucesso atrasado não apaga %s salvo pela segunda conexão', async status => {
    const entered = deferred(), release = deferred();
    fetchDfeNFSe.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return batch(); });
    const pending = conferirCompetencia(args());
    await entered.promise;
    let newer;
    try { newer = await second.apuracaoSnapshot.update({ where: { id: snap.id }, data: { conferenciaStatus: status,
      conferenciaResultado: { faltantes: ['contemporanea'] }, conferidaEm: status === 'divergente' ? new Date() : null } }); }
    finally { release.resolve(); }
    await expect(pending).rejects.toMatchObject({ code: 'CONFERENCIA_ADN_OBSOLETA' });
    expect(await readSnap()).toEqual(newer);
    expect(await readNota()).toEqual(nota);
    expect(await prisma.pendenciaPosFechamento.count({ where: { portalClientId } })).toBe(0);
  });
  test.each([['SQL NULL', Prisma.DbNull], ['JSON null', Prisma.JsonNull]])('CAS reconhece %s e repetição não duplica efeito', async (_, value) => {
    await prisma.apuracaoSnapshot.update({ where: { id: snap.id }, data: { conferenciaResultado: value } });
    expect(await conferirCompetencia(args())).toMatchObject({ persistido: true, resultado: { marcadasCanceladas: 1 } });
    expect((await readNota()).statusEfetivo).toBe('cancelada');
    expect(await prisma.pendenciaPosFechamento.count({ where: { portalClientId } })).toBe(1);
    expect(await conferirCompetencia(args())).toMatchObject({ resultado: { marcadasCanceladas: 0 } });
    expect(await prisma.pendenciaPosFechamento.count({ where: { portalClientId } })).toBe(1);
  });
  test('falha após cancelamento desfaz nota, snapshot e aviso', async () => {
    registrarPendenciaDoPeriodo.mockImplementationOnce(async (...args) => {
      await jest.requireActual('../../../pendenciasDoPeriodo.js').registrarPendenciaDoPeriodo(...args);
      throw new Error('FALHA_SINTETICA_APOS_AVISO');
    });
    await expect(conferirCompetencia(args())).rejects.toThrow('FALHA_SINTETICA_APOS_AVISO');
    expect(await readSnap()).toEqual(snap); expect(await readNota()).toEqual(nota);
    expect(await prisma.pendenciaPosFechamento.count({ where: { portalClientId } })).toBe(0);
  });
  test('mês fechado recusa tudo e preserva fechamento e lançamentos', async () => {
    const circular = await prisma.companyMonthlyCircular.create({ data: { portalClientId, competencia, fechadoContabilEm: new Date() } });
    const entry = await prisma.accountingEntry.create({ data: { portalClientId, competencia, data: new Date('2026-10-01'), historico: 'SINTETICO', tipo: 'RECEITA', status: 'CONFIRMADO' } });
    await expect(conferirCompetencia(args())).rejects.toHaveProperty('code', 'MES_CONTABIL_FECHADO_REQUER_REVISAO');
    expect(await readSnap()).toEqual(snap); expect(await readNota()).toEqual(nota);
    expect(await prisma.companyMonthlyCircular.findUnique({ where: { id: circular.id } })).toEqual(circular);
    expect(await prisma.accountingEntry.findUnique({ where: { id: entry.id } })).toEqual(entry);
    expect(await prisma.pendenciaPosFechamento.count({ where: { portalClientId } })).toBe(0);
  });
  test('snapshot inexistente continua ausente após conclusão sem documentos', async () => {
    await prisma.apuracaoSnapshot.delete({ where: { id: snap.id } });
    await prisma.portalInvoice.delete({ where: { id: nota.id } });
    fetchDfeNFSe.mockResolvedValueOnce({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', items: [], errors: [{ Codigo: 'E2220' }] });
    expect(await conferirCompetencia(args())).toMatchObject({ status: 'ok', persistido: false });
    expect(await prisma.apuracaoSnapshot.count({ where: { portalClientId } })).toBe(0);
  });
});
