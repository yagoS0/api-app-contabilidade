import { listarErrosConsultas } from '../OperationsConsultas.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

it.each(['recusada_cooldown', 'recusada_teto', 'incerta', 'reservada'])('preserva erro após %s e só sucesso posterior resolve', async status => {
  const erro = { id: 'erro', assinatura: 's', portalClientId: 'a', status: 'erro' };
  const attempt = { ...erro, id: 'tentativa', status };
  const db = { serproChamada: { findMany: jest.fn().mockResolvedValue([attempt, erro]) } };
  const pending = await listarErrosConsultas(db, ['a'], '2026-10');
  expect(pending.items).toEqual([expect.objectContaining({ id: 'erro', tentativaPosterior: expect.objectContaining({ id: 'tentativa', status }) })]);
  expect(pending.tentativasPendentes).toHaveLength(1);
  db.serproChamada.findMany.mockResolvedValue([{ ...erro, id: 'sucesso', status: 'ok' }, attempt, erro]);
  expect(await listarErrosConsultas(db, ['a'], '2026-10')).toMatchObject({ items: [], total: 0, tentativasPendentes: [] });
});

const localUrl = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL || process.env.ALTAN_P0_DATABASE_URL;
(localUrl ? test : test.skip)('PostgreSQL: erro → recusa → sucesso seleciona resultado efetivo com isolamento', async () => {
  const target = new URL(localUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || !target.pathname.endsWith('_governance_test') || target.searchParams.has('host')) {
    throw Error('Somente PostgreSQL loopback descartável _governance_test.');
  }
  const db = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const prefix = `consultas-${randomUUID()}`;
  const ids = ['erro', 'recusa', 'sucesso', 'outra', 'mes', 'emissao'].map(s => `${prefix}-${s}`);
  const base = { cnpj: '', portalClientId: prefix, assinatura: prefix, competencia: '2026-10', rota: '/Consultar', idServico: 'TESTE_LOCAL' };
  try {
    await db.serproChamada.createMany({ data: [
      { ...base, id: ids[0], status: 'erro', createdAt: new Date('2026-10-01T10:00:00Z') },
      { ...base, id: ids[3], status: 'erro', portalClientId: `${prefix}-outra` },
      { ...base, id: ids[4], status: 'erro', competencia: '2026-09' },
      { ...base, id: ids[5], status: 'erro', rota: '/Emitir' },
    ] });
    expect((await listarErrosConsultas(db, [prefix], '2026-10')).items.map(i => i.id)).toEqual([ids[0]]);
    await db.serproChamada.create({ data: { ...base, id: ids[1], status: 'recusada_cooldown', createdAt: new Date('2026-10-01T10:01:00Z') } });
    const pending = await listarErrosConsultas(db, [prefix], '2026-10');
    expect(pending.total).toBe(1);
    expect(pending.items[0]).toMatchObject({ id: ids[0], tentativaPosterior: { id: ids[1], situacao: 'bloqueada' } });
    await db.serproChamada.create({ data: { ...base, id: ids[2], status: 'ok', createdAt: new Date('2026-10-01T10:02:00Z') } });
    expect(await listarErrosConsultas(db, [prefix], '2026-10')).toMatchObject({ items: [], total: 0, tentativasPendentes: [] });
  } finally {
    try { await db.serproChamada.deleteMany({ where: { id: { in: ids } } }); }
    finally { await db.$disconnect(); }
  }
}, 30000);
it('consulta somente a carteira e competência, exclui envio/emissão e retorna o mesmo conjunto contado', async () => {
  const db = { serproChamada: { findMany: jest.fn(async () => [
    { id: 'erro', portalClientId: 'a', competencia: '2026-10', status: 'erro', idServico: 'CONS', erroMensagem: 'Recusa' },
    { id: 'ok', portalClientId: 'b', status: 'ok' }, { id: 'bloqueio', portalClientId: 'c', status: 'recusada_cooldown' },
  ]) } };
  const r = await listarErrosConsultas(db, ['a', 'b', 'c'], '2026-10');
  expect(db.serproChamada.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: { in: ['a', 'b', 'c'] }, competencia: '2026-10', rota: '/Consultar' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
  expect(r.total).toBe(r.items.length); expect(r.items).toEqual([expect.objectContaining({ id: 'erro', companyId: 'a', errorMessage: 'Recusa' })]);
});
it('recusa mês inválido antes de consultar e não transforma erro em zero', async () => {
  const db = { serproChamada: { findMany: jest.fn().mockRejectedValue(Error('offline')) } };
  await expect(listarErrosConsultas(db, ['a'], '2026-13')).rejects.toMatchObject({ status: 422 });
  expect(db.serproChamada.findMany).not.toHaveBeenCalled();
  await expect(listarErrosConsultas(db, ['a'], '2026-10')).rejects.toThrow('offline');
});
