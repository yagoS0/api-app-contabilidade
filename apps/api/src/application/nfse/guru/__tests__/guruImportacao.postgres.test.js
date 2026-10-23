jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { criarGuruConferencia } from '../GuruConferenciaService.js';
import { periodo, transacao, pagina } from './fixtures/transacoesGuru.js';

test('PG real: reserva concorrente, replay, conflito/conferência, rollback e isolamento', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('ALTAN_GOVERNANCE_TEST_DATABASE_URL obrigatória');
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) throw Error('Banco descartável local obrigatório');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const uuid = randomUUID(), companyId = `guru-import-${uuid}`, userId = `guru-import-user-${uuid}`, clientId = `guru-import-client-${uuid}`;
  const env = { NODE_ENV: 'test', GURU_CONFERENCIA_COMPANY_ID: companyId, GURU_CONFERENCIA_ACCOUNT_ID: `conta-${uuid}`,
    GURU_CONFERENCIA_IMPORT_ENABLED: 'true', GURU_CONFERENCIA_CREDENTIAL_SCOPE: 'EXCLUSIVE_PILOT', GURU_CONFERENCIA_USER_TOKEN: 'sintetico' };
  const provider = { pagina: jest.fn(async () => pagina()) };
  const args = { companyId, userId, body: periodo };
  const service = criarGuruConferencia({ db, env, http: provider });
  const semRede = () => { throw Error('Rede externa proibida'); };
  const spies = [jest.spyOn(http, 'request').mockImplementation(semRede), jest.spyOn(https, 'request').mockImplementation(semRede)];
  if (global.fetch) spies.push(jest.spyOn(global, 'fetch').mockImplementation(semRede));
  let liberar;
  try {
    await db.client.create({ data: { id: clientId, name: 'Fixture Guru', email: `${uuid}@example.invalid`, login: uuid, passwordHash: 'inutilizavel' } });
    await db.user.create({ data: { id: userId, email: `${uuid}@example.invalid`, passwordHash: 'inutilizavel', role: 'contador', status: 'active' } });
    await db.company.create({ data: { id: companyId, clientId, cnpj: `fixture-${uuid}`, razaoSocial: 'Fixture sem identidade fiscal', atividades: [] } });
    let iniciou;
    const emRede = new Promise(resolve => { iniciou = resolve; });
    provider.pagina.mockImplementationOnce(() => new Promise(resolve => { liberar = () => resolve(pagina()); iniciou(); }));
    const primeira = service.importar(args);
    await emRede;
    await expect(service.importar(args)).rejects.toMatchObject({ code: 'guru_importacao_ocupada' });
    expect((await service.listar(args)).ocupada).toBe(true);
    liberar();
    expect(await primeira).toMatchObject({ criadas: 1 });
    expect(await service.importar(args)).toMatchObject({ repetidas: 1 });
    const item = (await service.listar(args)).items[0];
    const comando = { ...args, id: item.id, body: { versao: item.versao, hash: item.hash, confirmada: true } };
    await service.conferir(comando);
    provider.pagina.mockResolvedValue(pagina([transacao('venda-sintetica', { status: 'refunded' })]));
    const concorrentes = await Promise.allSettled([service.importar(args), service.conferir(comando)]);
    expect(concorrentes[0].status).toBe('fulfilled');
    const alterada = await service.obter(comando);
    expect(alterada).toMatchObject({ id: item.id, estado: 'CONFLITO', versao: 3, conferencia: null });
    expect(alterada.historico).toHaveLength(3);
    await expect(service.conferir(comando)).rejects.toMatchObject({ status: 409 });

    // Intercepta somente a escrita de um registro importado, após gravá-lo no PG.
    // A transação deve reverter registro e auditoria; a falha da execução é separada.
    const failingDb = new Proxy(db, { get(target, prop) {
      if (prop !== '$transaction') return target[prop];
      return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(t, field) {
        if (field !== 'appSetting') return t[field];
        return new Proxy(t.appSetting, { get(model, method) {
          if (method !== 'create') return model[method];
          return async input => { const result = await model.create(input); if (input.data.key.startsWith('guru-conferencia:')) throw Error('falha_apos_escrita'); return result; };
        } });
      } })), options);
    } });
    provider.pagina.mockResolvedValue(pagina([transacao('rollback') ]));
    await expect(criarGuruConferencia({ db: failingDb, env, http: provider }).importar(args)).rejects.toThrow();
    expect((await service.listar(args)).total).toBe(1);
    expect(await service.obter(comando)).toEqual(alterada);
    expect((await service.listar(args)).ultimaImportacao).toMatchObject({ estado: 'FALHOU', gravadas: 0 });

    // Relógio injetado: A perde o lease enquanto seu GET ainda não retornou.
    // B arquiva A atomicamente; retorno e rejeição tardios não alteram B/A.
    let instante = new Date('2026-10-22T12:00:00Z');
    const leaseService = criarGuruConferencia({ db, env, http: provider, now: () => instante });
    for (const tardio of ['retorno', 'erro']) {
      let iniciarA, terminarA;
      const prontaA = new Promise(r => { iniciarA = r; });
      provider.pagina.mockImplementationOnce(() => new Promise((resolve, reject) => {
        terminarA = () => tardio === 'retorno' ? resolve(pagina([transacao('nao-importar-a')]))
          : reject(Object.assign(Error('causa privada'), { code: 'guru_timeout', status: 502 }));
        iniciarA();
      }));
      const tentativaA = leaseService.importar(args).catch(e => e);
      await prontaA;
      const a = (await leaseService.listar(args)).ultimaImportacao;
      const rowsA = await db.appSetting.findMany({ where: { key: { startsWith: 'guru-importacao:v1:' }, value: { path: ['execucaoId'], equals: a.execucaoId } } });
      const auditKey = rowsA.find(r => r.key.endsWith(`:${a.execucaoId}`)).key;
      const correnteKey = auditKey.slice(0, -(a.execucaoId.length + 1));
      instante = new Date(instante.getTime() + 240001);
      // Simula também reserva legada que caiu antes de criar seu histórico.
      if (tardio === 'retorno') await db.appSetting.delete({ where: { key: auditKey } });
      const antes = await db.appSetting.findUnique({ where: { key: correnteKey } });
      const falhaAuditoria = new Proxy(db, { get(target, prop) {
        if (prop !== '$transaction') return target[prop];
        return (fn, options) => target.$transaction(tx => fn(new Proxy(tx, { get(t, field) {
          if (field !== 'appSetting') return t[field];
          return new Proxy(t.appSetting, { get(model, method) {
            if (!['create', 'update'].includes(method)) return model[method];
            return async input => {
              const result = await model[method](input);
              if (input.data?.value?.estado === 'INTERROMPIDA') throw Error('auditoria_interrompida');
              return result;
            };
          } });
        } })), options);
      } });
      await expect(criarGuruConferencia({ db: falhaAuditoria, env, http: provider, now: () => instante }).importar(args)).rejects.toThrow('auditoria_interrompida');
      expect(await db.appSetting.findUnique({ where: { key: correnteKey } })).toEqual(antes);

      let iniciarB, terminarB;
      const prontaB = new Promise(r => { iniciarB = r; });
      provider.pagina.mockImplementationOnce(() => new Promise(resolve => { terminarB = () => resolve(pagina([])); iniciarB(); }));
      const tentativaB = leaseService.importar(args);
      await prontaB;
      const b = (await leaseService.listar(args)).ultimaImportacao;
      expect(b).toMatchObject({ estado: 'EM_ANDAMENTO' });
      expect(b.execucaoId).not.toBe(a.execucaoId);
      const arquivada = await db.appSetting.findUnique({ where: { key: auditKey } });
      expect(arquivada.value).toMatchObject({ ...a, estado: 'INTERROMPIDA', gravadas: 0 });
      terminarA();
      expect(await tentativaA).toMatchObject({ code: tardio === 'retorno' ? 'guru_importacao_interrompida' : 'guru_timeout' });
      expect(await db.appSetting.findUnique({ where: { key: auditKey } })).toEqual(arquivada);
      expect((await leaseService.listar(args)).ultimaImportacao).toEqual(b);
      terminarB();
      expect(await tentativaB).toMatchObject({ estado: 'CONCLUIDA', lidas: 0, criadas: 0 });
      expect(await db.appSetting.count({ where: { key: auditKey } })).toBe(1);
      expect((await leaseService.listar(args)).total).toBe(1);
      expect(await service.obter(comando)).toEqual(alterada);
    }
    env.GURU_CONFERENCIA_ACCOUNT_ID = 'outra-conta';
    expect((await service.listar(args)).total).toBe(0);
    await expect(service.obter(comando)).rejects.toMatchObject({ status: 404 });
    expect(await db.serviceInvoice.count({ where: { companyId } })).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    liberar?.();
    await db.appSetting.deleteMany({ where: { OR: [{ key: { startsWith: 'guru-conferencia:v1:' } }, { key: { startsWith: 'guru-importacao:v1:' } }], value: { path: ['companyId'], equals: companyId } } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.client.deleteMany({ where: { id: clientId } });
    await db.$disconnect(); for (const spy of spies) spy.mockRestore();
  }
}, 45000);
