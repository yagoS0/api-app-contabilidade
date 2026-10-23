jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../NfseService.js', () => ({ NfseService: { issue: jest.fn() } }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { criarGuruConferencia } from '../GuruConferenciaService.js';
import { NfseService } from '../../NfseService.js';

test('PostgreSQL descartável: concorrência, recarga e rollback da preparação/conferência', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('PostgreSQL descartável obrigatório: ALTAN_GOVERNANCE_TEST_DATABASE_URL.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) {
    throw Error('Banco recusado: exigir loopback, nome *_governance_test e nenhuma opção de conexão na URL.');
  }
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const id = randomUUID();
  const companyId = `guru-company-${id}`, userId = `guru-user-${id}`, clientId = `guru-client-${id}`;
  const env = { NODE_ENV: 'test', GURU_CONFERENCIA_COMPANY_ID: companyId, GURU_CONFERENCIA_ACCOUNT_ID: `guru-account-${id}` };
  const service = criarGuruConferencia({ db, env });
  const body = { transacaoId: `venda-${id}`, referenciaOrigem: 'Somente fixture local', valorCentavos: 12345,
    moeda: 'BRL', situacaoPagamento: 'INFORMADO_PAGO' };
  const args = { companyId, userId, body };
  const keys = [];
  const semRede = () => { throw Error('HTTP proibido no ensaio Guru'); };
  const spies = [jest.spyOn(http, 'request').mockImplementation(semRede), jest.spyOn(https, 'request').mockImplementation(semRede)];
  if (global.fetch) spies.push(jest.spyOn(global, 'fetch').mockImplementation(semRede));
  try {
    await db.client.create({ data: { id: clientId, name: 'Fixture Guru', email: `${id}@example.invalid`, login: id, passwordHash: 'inutilizavel' } });
    await db.user.create({ data: { id: userId, email: `${id}@example.invalid`, passwordHash: 'inutilizavel', role: 'contador', status: 'active' } });
    await db.company.create({ data: { id: companyId, clientId, razaoSocial: 'Fixture local sem identidade fiscal real',
      cnpj: `fixture-${id}`, atividades: [] } });
    const resultados = await Promise.all([service.preparar(args), service.preparar(args)]);
    expect(resultados[0].item.id).toBe(resultados[1].item.id);
    expect(resultados.filter(r => !r.repetida)).toHaveLength(1);
    const rows = await db.appSetting.findMany({ where: { value: { path: ['companyId'], equals: companyId } } });
    keys.push(...rows.map(r => r.key));
    expect(rows).toHaveLength(1);
    const item = resultados[0].item;
    expect(item).toMatchObject({ emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA' });
    expect(item).not.toHaveProperty('nota');
    expect(rows[0].value).toEqual(item);
    const comando = { companyId, userId, id: item.id, body: { versao: 1, hash: item.hash, confirmada: true } };

    // Falha APÓS a escrita, antes do commit: estado e auditoria precisam voltar juntos.
    const failingDb = new Proxy(db, { get(target, prop) {
      if (prop !== '$transaction') return target[prop];
      return (fn, options) => target.$transaction(async tx => {
        await fn(tx);
        throw Error('rollback_sintetico_apos_escrita');
      }, options);
    } });
    await expect(criarGuruConferencia({ db: failingDb, env }).conferir(comando)).rejects.toThrow('rollback_sintetico_apos_escrita');
    expect(await service.obter(comando)).toEqual(item);
    const conferencias = await Promise.all([service.conferir(comando), service.conferir(comando)]);
    expect(conferencias.filter(r => !r.repetida)).toHaveLength(1);
    const recarregado = await criarGuruConferencia({ db, env }).obter(comando);
    expect(recarregado.historico).toHaveLength(2);
    expect(recarregado).not.toHaveProperty('nota');
    expect(await service.preparar(args)).toEqual({ item: recarregado, repetida: true });
    expect(await service.conferir(comando)).toEqual({ item: recarregado, repetida: true });
    expect(recarregado).toMatchObject({ versao: 2, estado: 'CONFERIDA', emissaoBloqueada: true,
      emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA', entrega: 'NAO_REALIZADA', baixaContabil: 'NAO_REALIZADA' });
    await expect(service.preparar({ ...args, body: { ...body, valorCentavos: 999 } })).rejects.toMatchObject({ status: 409 });
    await expect(service.obter({ ...comando, companyId: 'empresa-alheia' })).rejects.toMatchObject({ status: 403 });
    await expect(service.emitir(comando)).rejects.toMatchObject({ code: 'guru_emissao_bloqueada_modo_conferencia' });
    expect(await db.serviceInvoice.count({ where: { companyId } })).toBe(0);
    expect(NfseService.issue).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    // Somente IDs criados por este ensaio; nenhum truncate ou limpeza global.
    await db.appSetting.deleteMany({ where: { key: { in: keys } } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.client.deleteMany({ where: { id: clientId } });
    await db.$disconnect();
    for (const spy of spies) spy.mockRestore();
  }
}, 30000);
