import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
let mockDb;
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, { get(_target, key) { const value = mockDb[key]; return typeof value === 'function' ? value.bind(mockDb) : value; } }) }));
import { autorizarLeituraConciliacaoDas445 } from '../../../infrastructure/security/autorizarLeituraConciliacaoDas445.js';
import { criarRegistroIndiceDocumentalPgdas, criarLeituraEstadoDocumentalPgdas } from '../../../modules/fiscal/infrastructure/prisma/estadoDocumentalPgdas.js';
import { consultarDocumentosPgdas, recuperarDocumentosPgdas } from '../../../modules/fiscal/application/recuperarDocumentosPgdas.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
let db; let outra;
async function fixture() {
  const id = randomUUID(); const cnpj = BigInt(`0x${id.replaceAll('-', '').slice(0, 11)}`).toString().padStart(14, '0');
  const client = await db.client.create({ data: { name: 'SYNTHETIC DOCUMENT FLOW', login: id, email: `${id}@example.test`, passwordHash: 'not-a-login' } });
  const company = await db.company.create({ data: { clientId: client.id, razaoSocial: 'SYNTHETIC DOCUMENT FLOW', cnpj, atividades: [] } });
  const portal = await db.portalClient.create({ data: { companyId: company.id, razao: company.razaoSocial, cnpj } });
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: 'not-a-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
  await db.companyFirmAccess.create({ data: { companyId: portal.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const entrada = { portalClientId: portal.id, competencia: '2026-11', confirmCompetencia: '2026-11' };
  const registro = { ...entrada, cnpj, numeroDeclaracao: `SYNTHETIC-${id}`, atorId: user.id };
  const portas = {
    autorizar: () => autorizarLeituraConciliacaoDas445(portal.id, { user }),
    ler: criarLeituraEstadoDocumentalPgdas(db),
    registrarConsulta: args => criarRegistroIndiceDocumentalPgdas(db)({ ...args, atorId: user.id }),
    consultarIndice: jest.fn(async () => ({ status: 200, dados: { periodo: { periodoApuracao: 202611, operacoes: [{ indiceDeclaracao: { numeroDeclaracao: registro.numeroDeclaracao } }] } } })),
    recuperarExtrato: jest.fn(async () => { throw Error('SYNTHETIC_PDF_UNAVAILABLE'); }),
    recuperarGuia: jest.fn(async () => { throw Error('UNEXPECTED_DAS_CALL'); }),
  };
  return { portal, user, entrada, registro, portas };
}
suite('documentos PGDAS: PostgreSQL16, ACL real e evidência durável sintética', () => {
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL; const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL || url.hostname !== '127.0.0.1'
      || url.pathname !== '/altan_piloto_governance_test' || url.search || url.hash) throw Error('Explicit disposable database required');
    db = new PrismaClient({ datasources: { db: { url: raw } } }); outra = new PrismaClient({ datasources: { db: { url: raw } } }); mockDb = db;
    await db.$connect(); await outra.$connect();
    const [server] = await db.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
    if (server.version < 160000 || server.version >= 170000) throw Error('PostgreSQL16 required');
  });
  afterAll(async () => { await db?.$disconnect(); await outra?.$disconnect(); });

  test('prova sobrevive à falha documental e reabertura sem criar cálculo, guia ou contabilização', async () => {
    const f = await fixture(); const result = await recuperarDocumentosPgdas(f.entrada, f.portas);
    expect(result).toMatchObject({ origem: 'DESCONHECIDA', partial: true, transmissao: { confirmada: true } });
    expect(f.portas.recuperarGuia).not.toHaveBeenCalled();
    expect(await consultarDocumentosPgdas(f.entrada, f.portas)).toMatchObject({ origem: 'DESCONHECIDA', partial: true, numeroDeclaracao: f.registro.numeroDeclaracao });
    expect(await db.apuracaoSnapshot.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect(await db.guide.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect(await db.companyMonthlyCircular.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });
  test('duas conexões concorrentes preservam uma evidência e replay não muda ator nem instante', async () => {
    const f = await fixture(); const before = await Promise.all([criarRegistroIndiceDocumentalPgdas(db)(f.registro), criarRegistroIndiceDocumentalPgdas(outra)(f.registro)]);
    expect(before[1]).toEqual(before[0]);
    const replay = await criarRegistroIndiceDocumentalPgdas(outra)({ ...f.registro, atorId: 'OUTRO_ATOR_SINTETICO' });
    expect(replay).toEqual(before[0]);
    expect(await db.appSetting.count({ where: { key: { startsWith: `pgdas_indice_documental:${f.portal.id}:2026-11:` } } })).toBe(1);
  });
  test('concorrência repetida não aborta transações nem altera o primeiro registro', async () => {
    const f = await fixture();
    for (let i = 0; i < 12; i += 1) {
      const registro = { ...f.registro, numeroDeclaracao: `${f.registro.numeroDeclaracao}-race-${i}` };
      const [primeira, segunda] = await Promise.all([
        db.$transaction(tx => criarRegistroIndiceDocumentalPgdas(tx)(registro)),
        outra.$transaction(tx => criarRegistroIndiceDocumentalPgdas(tx)({ ...registro, atorId: 'SEGUNDO_ATOR_SINTETICO' })),
      ]);
      expect(segunda).toEqual(primeira);
      expect(await criarRegistroIndiceDocumentalPgdas(db)({ ...registro, atorId: 'REPLAY' })).toEqual(primeira);
    }
  });
  test('rollback da gravação do índice impede recuperação posterior e não deixa prova parcial', async () => {
    const f = await fixture();
    f.portas.registrarConsulta = args => db.$transaction(async tx => {
      await criarRegistroIndiceDocumentalPgdas(tx)({ ...args, atorId: f.user.id }); throw Error('SYNTHETIC_PERSISTENCE_FAILURE');
    });
    await expect(recuperarDocumentosPgdas(f.entrada, f.portas)).rejects.toThrow('SYNTHETIC_PERSISTENCE_FAILURE');
    expect(f.portas.recuperarExtrato).not.toHaveBeenCalled(); expect(f.portas.recuperarGuia).not.toHaveBeenCalled();
    expect((await f.portas.ler(f.entrada)).consulta).toBeNull();
  });
  test('revogação em outra conexão depois do índice impede gravação e documentos', async () => {
    const f = await fixture(); const indice = f.portas.consultarIndice.getMockImplementation();
    f.portas.consultarIndice.mockImplementation(async () => {
      await outra.companyFirmAccess.update({ where: { companyId_userId: { companyId: f.portal.id, userId: f.user.id } }, data: { status: 'REVOKED' } });
      return indice();
    });
    await expect(recuperarDocumentosPgdas(f.entrada, f.portas)).rejects.toMatchObject({ status: 403 });
    expect(f.portas.recuperarExtrato).not.toHaveBeenCalled(); expect((await f.portas.ler(f.entrada)).consulta).toBeNull();
  });
  test('leitura e persistência isolam empresa, PA e CNPJ; acesso sem vínculo é negado', async () => {
    const a = await fixture(); const b = await fixture(); await criarRegistroIndiceDocumentalPgdas(db)(a.registro);
    expect((await b.portas.ler(b.entrada)).consulta).toBeNull();
    expect((await a.portas.ler({ ...a.entrada, competencia: '2026-10' })).consulta).toBeNull();
    await expect(autorizarLeituraConciliacaoDas445(b.portal.id, { user: a.user })).rejects.toMatchObject({ status: 403 });
    await expect(criarRegistroIndiceDocumentalPgdas(db)({ ...a.registro, portalClientId: b.portal.id })).rejects.toMatchObject({ code: 'PGDAS_IDENTIDADE_DIVERGENTE' });
    const novoCnpj = (BigInt(`0x${randomUUID().replace(/-/g, '')}`) % 100000000000000n).toString().padStart(14, '0');
    await outra.portalClient.update({ where: { id: a.portal.id }, data: { cnpj: novoCnpj } });
    expect((await a.portas.ler(a.entrada)).consulta).toBeNull();
  });
});
