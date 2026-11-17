import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { criarPersistenciaFs12 } from '../fs12DaApuracao.js';
import { criarPersistenciaFs12DoCalculo } from '../fs12DoCalculo.js';
import { consultarFs12DaApuracao } from '../../../application/consultarFs12DaApuracao.js';
import { confirmarFs12DaApuracao } from '../../../application/confirmarFs12DaApuracao.js';
import { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo, consultarVinculoFs12DoCalculo, validarUsoFs12DoCalculo } from '../../../application/vincularFs12AoCalculo.js';
import { registrarFatoCalculoFs12 } from '../../../application/registrarFatoCalculoFs12.js';
import { hashCalculo, validarCalculoConfirmado } from '../../../../../application/notas/apuracao/v2/CalculoConfirmado.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
let db; let other;
const date = s => new Date(`${s}T00:00:00.000Z`);
async function fixture() {
  const id = randomUUID();
  const client = await db.client.create({ data: { name: 'SYNTHETIC FS12 B32', login: id, email: `${id}@example.test`, passwordHash: 'not-a-login' } });
  const company = await db.company.create({ data: { clientId: client.id, razaoSocial: 'SYNTHETIC FS12 B32', cnpj: id, atividades: [], dataAbertura: date('2026-11-01') } });
  const portal = await db.portalClient.create({ data: { companyId: company.id, razao: 'SYNTHETIC FS12 B32', cnpj: id } });
  const user = await db.user.create({ data: { name: 'Synthetic accountant', email: `${randomUUID()}@example.test`, passwordHash: 'not-a-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
  await db.companyFirmAccess.create({ data: { companyId: portal.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  await db.regimeHistorico.create({ data: { companyId: company.id, regime: 'SIMPLES', vigenciaInicio: date('2026-11-01') } });
  const identidade = { portalClientId: portal.id, competencia: '2026-11', autorId: user.id };
  const b31 = criarPersistenciaFs12(db);
  const contexto = await consultarFs12DaApuracao(identidade, b31);
  const revisao = (await confirmarFs12DaApuracao({ ...identidade, serie: [{ mes: '2026-11', valorCentavos: 0 }],
    revisaoEsperada: 0, chaveIdempotencia: randomUUID(), contextoRevisao: contexto.contextoRevisao }, b31)).confirmacao;
  // Synthetic prepared envelope: no B32 path actually produces a November/December simulation.
  const dados = { portalClientId: portal.id, competencia: identidade.competencia,
    formulario: { atividades: [], folhaMensal12: [0], regimeApuracao: 'COMPETENCIA' }, receitasBrutasAnteriores: [], folhasSalario: [],
    fs12: { revisaoId: revisao.id, revisao: 1, contextoHash: revisao.contextoRevisao, politicaVersao: revisao.politicaVersao } };
  const calculo = { ...dados, calculoId: `fech:v1:${randomUUID()}:${hashCalculo(dados)}` };
  const snapshot = await db.apuracaoSnapshot.create({ data: { portalClientId: portal.id, competencia: identidade.competencia,
    rbt12: 0, receitaPorTipo: {}, atividadesEscolhidas: [], folhaMensal12: [0], simulacaoSerpro: { _portalCalculo: calculo },
    estado: 'calculada', idempotencyKey: calculo.calculoId, numeroDeclaracao: 'OLD-NUMBER-NOT-THIS-CALCULATION' } });
  return { company, portal, user, identidade, revisao, calculo, snapshot,
    entrada: { ...identidade, calculoId: calculo.calculoId, revisaoEsperada: 1, contextoHash: revisao.contextoRevisao } };
}
const persist = (extra = {}) => criarPersistenciaFs12DoCalculo({ db, validarSnapshot: validarCalculoConfirmado, ...extra });
suite('B32 immutable FS12 calculation evidence, PostgreSQL only', () => {
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const destination = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL
      || !['postgres:', 'postgresql:'].includes(destination.protocol) || destination.hostname !== '127.0.0.1'
      || destination.pathname !== '/altan_piloto_governance_test' || destination.search || destination.hash) throw Error('Explicit isolated B32 database required');
    db = new PrismaClient({ datasources: { db: { url: raw } } });
    other = new PrismaClient({ datasources: { db: { url: raw } } });
    await db.$connect(); await other.$connect();
    const [server] = await db.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
    if (server.version < 160000 || server.version >= 170000) throw Error('PostgreSQL16 required for B32 integration evidence');
  });
  afterAll(async () => { await db?.$disconnect(); await other?.$disconnect(); });

  test('exact frozen envelope, replay, re-opening/history and SQL immutability', async () => {
    const f = await fixture();
    const first = await vincularFs12AoCalculo(f.entrada, persist());
    expect(first.vinculo.calculoConfirmado).toEqual(f.calculo);
    expect(first.vinculo.calculoConfirmado.numeroDeclaracao).toBeUndefined();
    expect((await vincularFs12AoCalculo(f.entrada, persist())).replay).toBe(true);
    await db.apuracaoSnapshot.update({ where: { id: f.snapshot.id }, data: { estado: 'aberta', idempotencyKey: `reaberta:${randomUUID()}` } });
    expect((await consultarVinculoFs12DoCalculo(f.entrada, persist())).id).toBe(first.vinculo.id);
    await expect(validarUsoFs12DoCalculo(f.entrada, persist())).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
    await expect(db.apuracaoFs12Calculo.update({ where: { id: first.vinculo.id }, data: { contextoHash: 'a'.repeat(64) } })).rejects.toThrow();
    await expect(db.apuracaoFs12Calculo.delete({ where: { id: first.vinculo.id } })).rejects.toThrow();
  });
  test('no backfill from legacy snapshot even with a caller supplied reference/hash', async () => {
    const f = await fixture(); const { fs12, calculoId, ...dados } = f.calculo;
    const legacy = { ...dados, calculoId: `fech:v1:${randomUUID()}:${hashCalculo(dados)}` };
    await db.apuracaoSnapshot.update({ where: { id: f.snapshot.id }, data: { idempotencyKey: legacy.calculoId, simulacaoSerpro: { _portalCalculo: legacy } } });
    await expect(vincularFs12AoCalculo({ ...f.entrada, calculoId: legacy.calculoId, fs12, calculoHash: hashCalculo(legacy) }, persist())).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });
  test('same transaction rolls back both snapshot change and inserted link', async () => {
    const f = await fixture();
    await expect(db.$transaction(async tx => {
      await tx.apuracaoSnapshot.update({ where: { id: f.snapshot.id }, data: { estado: 'fechada' } });
      await vincularFs12AoCalculo(f.entrada, persist({ tx }));
      throw Error('SYNTHETIC_FAILURE_AFTER_LINK');
    }, { isolationLevel: 'Serializable' })).rejects.toThrow('SYNTHETIC_FAILURE_AFTER_LINK');
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect((await db.apuracaoSnapshot.findUnique({ where: { id: f.snapshot.id } })).estado).toBe('calculada');
  });
  test('two independent connections cannot replace or duplicate a link', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([vincularFs12AoCalculo(f.entrada, persist()), vincularFs12AoCalculo(f.entrada, persist({ db: other }))]);
    expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThan(0);
    expect(await db.apuracaoFs12Calculo.count({ where: { calculoId: f.calculo.calculoId } })).toBe(1);
    expect((await vincularFs12AoCalculo(f.entrada, persist())).replay).toBe(true);
  });
  test('caller transaction with default isolation cannot weaken the write contract', async () => {
    const f = await fixture();
    await expect(db.$transaction(async tx => {
      const [isolation] = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS nivel`;
      expect(isolation.nivel).toBe('read committed');
      await vincularFs12AoCalculo(f.entrada, persist({ tx }));
    })).rejects.toMatchObject({ code: 'FS12_TRANSACAO_INVALIDA' });
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
    expect((await db.apuracaoSnapshot.findUnique({ where: { id: f.snapshot.id } })).estado).toBe('calculada');
  });
  test('Company remapping and revoked access isolate historical data', async () => {
    const f = await fixture(); const g = await fixture(); await vincularFs12AoCalculo(f.entrada, persist());
    await db.portalClient.update({ where: { id: g.portal.id }, data: { companyId: null } });
    await db.portalClient.update({ where: { id: f.portal.id }, data: { companyId: g.company.id } });
    expect(await consultarVinculoFs12DoCalculo({ ...f.entrada, companyId: f.company.id }, persist())).toBeNull();
    await db.user.update({ where: { id: f.user.id }, data: { status: 'inactive' } });
    await expect(consultarVinculoFs12DoCalculo(f.entrada, persist())).rejects.toMatchObject({ status: 403 });
  });
  test('composite FK/trigger rejects mismatched revision identity and caller token', async () => {
    const f = await fixture(); const g = await fixture(); const link = (await vincularFs12AoCalculo(f.entrada, persist())).vinculo;
    const { criadoEm, id, ...data } = link;
    await expect(db.apuracaoFs12Calculo.create({ data: { ...data, companyId: g.company.id, calculoId: randomUUID() } })).rejects.toThrow();
    await expect(db.apuracaoFs12Calculo.create({ data: { ...data, calculoId: randomUUID(), contextoHash: 'f'.repeat(64) } })).rejects.toThrow();
  });
  test('fiscal facts default closed; trusted synthetic reader proves correlation and immutable facts', async () => {
    const f = await fixture(); const link = (await vincularFs12AoCalculo(f.entrada, persist())).vinculo;
    const input = { ...f.entrada, tentativaId: randomUUID(), tipo: 'TENTATIVA_INICIADA', chaveIdempotencia: randomUUID(), evidenciaReferencia: randomUUID() };
    await expect(registrarFatoCalculoFs12(input, persist())).rejects.toMatchObject({ code: 'FS12_FATO_SEM_EVIDENCIA' });
    const evidence = { portalClientId: f.portal.id, companyId: f.company.id, competencia: '2026-11', calculoId: f.calculo.calculoId,
      tipo: input.tipo, tentativaId: input.tentativaId, referencia: input.evidenciaReferencia, origem: 'SYNTHETIC_TRUSTED_READER' };
    const deps = persist({ lerEvidenciaFiscal: async (_input, tx) => { expect(tx).toBeDefined(); return evidence; } });
    const first = await registrarFatoCalculoFs12(input, deps);
    Object.assign(evidence, { tipo: 'RESULTADO_INCERTO' });
    await registrarFatoCalculoFs12({ ...input, tipo: evidence.tipo, chaveIdempotencia: randomUUID() }, deps);
    Object.assign(evidence, { tipo: 'RESULTADO_CONCILIADO', proveniencia: 'RECIBO_OFICIAL_CORRELACIONADO', numeroDeclaracao: 'SYNTHETIC-D1' });
    const result = await registrarFatoCalculoFs12({ ...input, tipo: evidence.tipo, chaveIdempotencia: randomUUID() }, deps);
    expect(result.fato.numeroDeclaracao).toBe('SYNTHETIC-D1');
    expect(await db.apuracaoFs12CalculoFato.count({ where: { vinculoId: link.id } })).toBe(3);
    expect((await db.apuracaoSnapshot.findUnique({ where: { id: f.snapshot.id } })).estado).toBe('calculada');
    await expect(db.apuracaoFs12CalculoFato.delete({ where: { id: first.fato.id } })).rejects.toThrow();
    await expect(db.apuracaoFs12CalculoFato.update({ where: { id: first.fato.id }, data: { tipo: 'RESULTADO_CONFIRMADO' } })).rejects.toThrow();
  });
  test('read-only preparation never creates a new calculation or fiscal fact', async () => {
    const f = await fixture();
    const proof = await prepararFs12ParaNovoCalculo(f.identidade, persist());
    expect(proof.autorizaEfeitoFiscal).toBe(false);
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });
  test('concurrent confirmation cannot silently change the revision consumed by a calculation', async () => {
    const f = await fixture();
    const command = { ...f.identidade, serie: [{ mes: '2026-11', valorCentavos: 1 }],
      revisaoEsperada: 1, chaveIdempotencia: randomUUID(), contextoRevisao: f.revisao.contextoRevisao, motivo: 'Synthetic corrected confirmation' };
    const results = await Promise.allSettled([
      vincularFs12AoCalculo(f.entrada, persist()), confirmarFs12DaApuracao(command, criarPersistenciaFs12(other)),
    ]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    // Retry only the local confirmation if serialization selected it as the loser.
    await confirmarFs12DaApuracao(command, criarPersistenciaFs12(db));
    const link = await consultarVinculoFs12DoCalculo(f.entrada, persist());
    if (link) expect(link.revisaoFs12).toBe(1);
    await expect(validarUsoFs12DoCalculo(f.entrada, persist())).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
    expect(await db.apuracaoFs12Revisao.count({ where: { portalClientId: f.portal.id } })).toBe(2);
  });
  test('revocation committed before the write transaction prevents link and replay', async () => {
    const f = await fixture();
    await other.user.update({ where: { id: f.user.id }, data: { status: 'inactive' } });
    await expect(vincularFs12AoCalculo(f.entrada, persist())).rejects.toMatchObject({ status: 403 });
    expect(await db.apuracaoFs12Calculo.count({ where: { portalClientId: f.portal.id } })).toBe(0);
  });
});
