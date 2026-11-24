// Explicit disposable PostgreSQL 16 only; never use DATABASE_URL or real providers.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { assertDisposablePostgres } from '../../../test-support/disposablePostgresGuard.js';
import { criarPersistenciaCancelamento, chaveReservaCancelamento } from '../../../modules/nfse/infrastructure/prisma/cancelamentoFiscal.js';
import { criarCancelamentoFiscal } from '../../../modules/nfse/application/cancelamentoFiscal.js';
import { decidirConfirmacaoFiscalCancelamento } from '../../../modules/nfse/domain/confirmacaoFiscalCancelamento.js';

const enabled = process.env.RUN_NFSE_CANCELAMENTO_POSTGRES === '1';
const pg = enabled ? describe : describe.skip;
pg('Cancelamento fiscal: PostgreSQL 16 descartável, duas conexões', () => {
  let db, second, ready = false, clientId;
  const companyIds = [], invoiceIds = [], keys = [];
  const tag = randomUUID();
  beforeAll(async () => {
    const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
    const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) throw Error('Explicit disposable loopback database required');
    db = new PrismaClient({ datasources: { db: { url: raw } } });
    const [actual] = await db.$queryRawUnsafe(`SELECT current_database() AS name, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('server_version_num') AS "versionNumber"`);
    assertDisposablePostgres({ raw, actual });
    if (Number(actual.versionNumber) < 160000 || Number(actual.versionNumber) >= 170000) throw Error('PostgreSQL 16 required');
    second = new PrismaClient({ datasources: { db: { url: raw } } });
    ready = true;
    const client = await db.client.create({ data: { name: 'Synthetic cancellation test', email: tag + '@invalid.test', login: tag, passwordHash: 'not-a-credential' } });
    clientId = client.id;
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (ready) {
      if (keys.length) await db.appSetting.deleteMany({ where: { OR: keys.map(key => ({ key: { startsWith: key } })) } });
      await db.serviceInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await db.company.deleteMany({ where: { id: { in: companyIds } } });
      if (clientId) await db.client.delete({ where: { id: clientId } });
    }
    await second?.$disconnect(); await db?.$disconnect();
  });
  async function fixture(ambiente = 'producao') {
    const company = await db.company.create({ data: { clientId, razaoSocial: 'Synthetic ' + tag,
      cnpj: String(70000000000000 + randomInt(1000000000000)), atividades: [] } });
    companyIds.push(company.id);
    const chaveAcesso = BigInt('0x' + randomUUID().replace(/-/g, '')).toString().padStart(50, '0');
    const invoice = await db.serviceInvoice.create({ data: { companyId: company.id, chaveAcesso,
      tomadorDoc: '11111111000191', tomadorNome: 'Synthetic only', valorServicos: 1,
      status: 'issued', xml: `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><tpAmb>${ambiente === 'producao' ? 1 : 2}</tpAmb></NFSe>` } });
    invoiceIds.push(invoice.id);
    const contexto = { companyId: company.id, cnpj: company.cnpj, chaveAcesso, ambiente };
    keys.push(chaveReservaCancelamento(contexto));
    return { contexto, invoice };
  }
  function evidence(contexto, tipoEvento = '101101') {
    const xml = '<synthetic-event-' + randomUUID() + '/>';
    return { ...contexto, tipoEvento, sequencia: '1', id: `EVT${contexto.chaveAcesso}${tipoEvento}001`,
      pedidoId: `PRE${contexto.chaveAcesso}${tipoEvento}`, integridadeVerificada: true, origemVerificada: true,
      hash: createHash('sha256').update(xml).digest('hex'), xml };
  }
  const current = r => db.appSetting.findUnique({ where: { key: r.key } });
  const invoice = f => db.serviceInvoice.findUnique({ where: { id: f.invoice.id } });
  async function confirm(adapter, reserva, f, ev = evidence(f.contexto)) {
    return adapter.registrarResultado(reserva, f.contexto, ev, decidirConfirmacaoFiscalCancelamento(ev, f.contexto));
  }
  test('duas conexões competem pela mesma reserva: somente uma pode despachar', async () => {
    const f = await fixture();
    const a = criarPersistenciaCancelamento(db), b = criarPersistenciaCancelamento(second);
    const rs = await Promise.all([a.reservar(f.contexto), b.reservar(f.contexto)]);
    expect(rs.filter(r => r.nova)).toHaveLength(1);
    expect(rs[0].value.token).toBe(rs[1].value.token);
    const winner = rs.find(r => r.nova);
    await a.marcarDespacho(winner);
    expect((await current(winner)).value.status).toBe('DESPACHADO');
    expect((await invoice(f)).status).toBe('issued');
  });
  test('confirmação e replay preservam uma evidência e um aviso', async () => {
    const f = await fixture(), notice = jest.fn();
    const a = criarPersistenciaCancelamento(db, { aposConfirmacao: notice });
    const r = await a.reservar(f.contexto), ev = evidence(f.contexto);
    await a.marcarDespacho(r); await confirm(a, r, f, ev);
    const replay = await a.reservar(f.contexto);
    expect(replay.nova).toBe(false);
    await confirm(a, replay, f, ev);
    expect((await invoice(f)).status).toBe('cancelled');
    expect((await invoice(f)).revisaoPeriodoPendente).toBe(true);
    expect(await db.appSetting.count({ where: { key: { startsWith: r.key + ':evento:' } } })).toBe(1);
    expect(notice).toHaveBeenCalledTimes(1);
  });
  test('alteração concorrente da nota impede projeção mas preserva resposta tardia', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db);
    const r = await a.reservar(f.contexto); await a.marcarDespacho(r);
    await second.serviceInvoice.update({ where: { id: f.invoice.id }, data: { status: 'rejected' } });
    const ev = evidence(f.contexto);
    await expect(confirm(a, r, f, ev)).rejects.toHaveProperty('code', 'NFSE_CANCELAMENTO_CONCORRENTE');
    expect((await invoice(f)).status).toBe('rejected');
    expect((await db.appSetting.findUnique({ where: { key: r.key + ':evento:' + ev.hash } })).value.xml).toBe(ev.xml);
    expect((await current(r)).value.status).toBe('DESPACHADO');
  });
  test('duas conexões: alteração entre leitura transacional e CAS não é sobrescrita', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db);
    const r = await a.reservar(f.contexto); await a.marcarDespacho(r);
    let arrived, release;
    const read = new Promise(resolve => { arrived = resolve; });
    const proceed = new Promise(resolve => { release = resolve; });
    const original = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementation((callback, options) => original(async tx => {
      const proxy = new Proxy(tx, { get(target, prop) {
        if (prop !== 'serviceInvoice') return target[prop];
        return new Proxy(tx.serviceInvoice, { get(model, method) {
          if (method !== 'updateMany') return typeof model[method] === 'function' ? model[method].bind(model) : model[method];
          return async args => { arrived(); await proceed; return model.updateMany(args); };
        } });
      } });
      return callback(proxy);
    }, options));
    const ev = evidence(f.contexto);
    const attempt = confirm(a, r, f, ev).then(value => ({ value }), error => ({ error }));
    try {
      await read;
      await second.serviceInvoice.update({ where: { id: f.invoice.id }, data: { status: 'rejected' } });
      release();
      expect((await attempt).error).toHaveProperty('code', 'NFSE_CANCELAMENTO_CONCORRENTE');
      expect((await invoice(f)).status).toBe('rejected');
      expect((await current(r)).value.status).toBe('DESPACHADO');
      expect(await db.appSetting.findUnique({ where: { key: r.key + ':evento:' + ev.hash } })).not.toBeNull();
    } finally { release(); await attempt; spy.mockRestore(); }
  });
  test('CAS perdido na reserva reverte a atualização da nota sem apagar custódia', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db);
    const r = await a.reservar(f.contexto); await a.marcarDespacho(r);
    await second.appSetting.update({ where: { key: r.key }, data: { value: { ...r.value, status: 'INCERTO', concorrente: true } } });
    const ev = evidence(f.contexto);
    await expect(confirm(a, r, f, ev)).rejects.toHaveProperty('code', 'NFSE_CANCELAMENTO_CONCORRENTE');
    expect((await invoice(f)).status).toBe('issued');
    expect((await current(r)).value.concorrente).toBe(true);
    expect(await db.appSetting.findUnique({ where: { key: r.key + ':evento:' + ev.hash } })).not.toBeNull();
  });
  test('recibo antigo e falha tardia não rebaixam confirmação fiscal', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), b = criarPersistenciaCancelamento(second);
    const r = await a.reservar(f.contexto), old = await b.reservar(f.contexto);
    await a.marcarDespacho(r); await confirm(a, r, f);
    const pending = evidence(f.contexto, '101103');
    await expect(confirm(b, old, f, pending)).rejects.toHaveProperty('code');
    await b.registrarFalha(old, { incerto: true, codigo: 'TIMEOUT' });
    expect((await current(r)).value.status).toBe('CONFIRMADO');
    expect((await invoice(f)).status).toBe('cancelled');
  });
  test.each(['101103', '105105'])('evento %s persiste resultado sem cancelar', async tipo => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto);
    const ev = evidence(f.contexto, tipo); await confirm(a, r, f, ev);
    expect((await invoice(f)).status).toBe('issued');
    expect((await current(r)).value.status).toBe(tipo === '101103' ? 'PENDENTE' : 'INDEFERIDO');
  });
  test.each(['companyId', 'chaveAcesso', 'ambiente'])('identidade divergente %s não guarda XML alheio', async field => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto);
    const ev = evidence(f.contexto); ev[field] = field === 'ambiente' ? 'homologacao' : 'different';
    await expect(confirm(a, r, f, ev)).rejects.toHaveProperty('code');
    expect((await invoice(f)).status).toBe('issued');
    const saved = await db.appSetting.findMany({ where: { key: { startsWith: r.key } } });
    expect(JSON.stringify(saved)).not.toContain(ev.xml);
  });
  test('empresa diferente e ambiente incompatível não reservam nem alteram documento', async () => {
    const f = await fixture(), other = await fixture(), a = criarPersistenciaCancelamento(db);
    const wrongCompany = { ...f.contexto, companyId: other.contexto.companyId, cnpj: other.contexto.cnpj };
    const wrongEnv = { ...f.contexto, ambiente: 'homologacao' };
    keys.push(chaveReservaCancelamento(wrongCompany), chaveReservaCancelamento(wrongEnv));
    await expect(a.reservar(wrongCompany)).rejects.toHaveProperty('code');
    await expect(a.reservar(wrongEnv)).rejects.toHaveProperty('code');
    expect((await invoice(f)).status).toBe('issued');
    expect(await db.appSetting.count({ where: { key: { in: keys.slice(-2) } } })).toBe(0);
  });
  test('timeout e reentrada consultam sem retransmitir; resposta válida recupera estado', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db);
    const enviar = jest.fn().mockRejectedValue(Object.assign(new Error('Synthetic timeout'), { code: 'ETIMEDOUT' }));
    const consultar = jest.fn().mockResolvedValue(evidence(f.contexto));
    const cancelar = criarCancelamentoFiscal({ ...a, verificarResposta: x => x });
    const args = { contexto: f.contexto, revalidarAutorizacao: jest.fn(), prepararTransporte: async () => ({ enviar, consultar }) };
    await expect(cancelar(args)).rejects.toHaveProperty('code', 'NFSE_CANCELAMENTO_NAO_CONFIRMADO');
    expect((await invoice(f)).status).toBe('issued');
    await expect(cancelar(args)).resolves.toHaveProperty('confirmacaoFiscal', true);
    expect(enviar).toHaveBeenCalledTimes(1); expect(consultar).toHaveBeenCalledTimes(1);
    expect((await invoice(f)).status).toBe('cancelled');
  });
  test('revogação na segunda verificação de autorização impede o POST', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), enviar = jest.fn(), consultar = jest.fn();
    const auth = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'UNAUTHORIZED' }));
    const cancelar = criarCancelamentoFiscal({ ...a, verificarResposta: x => x });
    await expect(cancelar({ contexto: f.contexto, revalidarAutorizacao: auth, prepararTransporte: async () => ({ enviar, consultar }) })).rejects.toHaveProperty('code', 'UNAUTHORIZED');
    expect(enviar).not.toHaveBeenCalled(); expect(consultar).not.toHaveBeenCalled();
    expect((await invoice(f)).status).toBe('issued');
  });
  test.each(['cancelled', 'cancelled_substitution'])('nota legada %s sem reserva não permite novo POST', async status => {
    const f = await fixture();
    await db.serviceInvoice.update({ where: { id: f.invoice.id }, data: { status } });
    const a = criarPersistenciaCancelamento(db);
    const enviar = jest.fn(), consultar = jest.fn().mockResolvedValue(null);
    const cancelar = criarCancelamentoFiscal({ ...a, verificarResposta: x => x });
    await expect(cancelar({ contexto: f.contexto, revalidarAutorizacao: jest.fn(), prepararTransporte: async () => ({ enviar, consultar }) })).rejects.toHaveProperty('code', 'NFSE_CANCELAMENTO_NAO_CONFIRMADO');
    expect(enviar).not.toHaveBeenCalled(); expect(consultar).toHaveBeenCalledTimes(1);
    expect((await invoice(f)).status).toBe(status);
  });

  test('coleção conflitante mantém custódia deduplicada e decisão auditável sem cancelar', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto);
    const deferido = evidence(f.contexto, '105104'), indeferido = evidence(f.contexto, '105105');
    const lote = { evidencias: [deferido, indeferido, deferido], completa: true, problemas: [] };
    const result = await confirm(a, r, f, lote);
    expect(result.decisao).toMatchObject({ situacao: 'INCONCLUSIVO', cancelada: false });
    expect((await invoice(f)).status).toBe('issued');
    expect(await db.appSetting.count({ where: { key: { startsWith: r.key + ':evento:' } } })).toBe(2);
    expect(await db.appSetting.count({ where: { key: { startsWith: r.key + ':decisao:' } } })).toBe(1);
    const replay = await a.reservar(f.contexto);
    await confirm(a, replay, f, lote);
    expect(await db.appSetting.count({ where: { key: { startsWith: r.key + ':evento:' } } })).toBe(2);
  });
  test('resposta parcial custodia evento válido sem projetar cancelamento', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto);
    const ev = evidence(f.contexto);
    const result = await confirm(a, r, f, { evidencias: [ev], completa: false, problemas: ['XML_OU_METADATA_INCOMPATIVEL'] });
    expect(result.decisao.cancelada).toBe(false);
    expect((await invoice(f)).status).toBe('issued');
    expect((await db.appSetting.findUnique({ where: { key: r.key + ':evento:' + ev.hash } })).value.xml).toBe(ev.xml);
  });
  test('ausência posterior não promove evento custodiado em resposta parcial', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto), ev = evidence(f.contexto);
    await confirm(a, r, f, { evidencias: [ev], completa: false, problemas: ['XML_OU_METADATA_INCOMPATIVEL'] });
    const consulta = await a.reservar(f.contexto);
    const result = await confirm(a, consulta, f, { evidencias: [], completa: true, problemas: ['AUSENCIA_EVENTOS'] });
    expect(result.decisao).toMatchObject({ situacao: 'INCONCLUSIVO', cancelada: false });
    expect((await invoice(f)).status).toBe('issued');
    expect((await current(consulta)).value.status).toBe('INCONCLUSIVO');
    // Nova evidência atual completa, não a ausência, permite recuperação.
    const recuperacao = await a.reservar(f.contexto);
    const valido = await confirm(a, recuperacao, f, { evidencias: [ev, ev], completa: true, problemas: [] });
    expect(valido.decisao.cancelada).toBe(true);
    expect(valido.evidencias).toHaveLength(1);
    expect((await invoice(f)).status).toBe('cancelled');
  });
  test.each([['105104', '105105'], ['105105', '105104']])('duas conexões: %s e %s entre histórico e CAS invalidam projeção', async (primeiroTipo, segundoTipo) => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), b = criarPersistenciaCancelamento(second);
    const r = await a.reservar(f.contexto), concorrente = await b.reservar(f.contexto);
    const deferido = evidence(f.contexto, primeiroTipo), indeferido = evidence(f.contexto, segundoTipo);
    let arrived, release;
    const read = new Promise(resolve => { arrived = resolve; });
    const proceed = new Promise(resolve => { release = resolve; });
    const original = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementation((callback, options) => original(tx => callback(new Proxy(tx, {
      get(target, prop) {
        if (prop !== 'appSetting') return target[prop];
        return new Proxy(tx.appSetting, { get(model, method) {
          if (method !== 'findMany') return typeof model[method] === 'function' ? model[method].bind(model) : model[method];
          return async args => { const rows = await model.findMany(args); arrived(); await proceed; return rows; };
        } });
      },
    })), options));
    const attempt = confirm(a, r, f, deferido).then(value => ({ value }), error => ({ error }));
    try {
      await read;
      // A resposta de B é custodiada mesmo com snapshot obsoleto; a revisão
      // durável avança antes de A tentar projetar sua leitura antiga.
      await expect(confirm(b, concorrente, f, indeferido)).rejects.toHaveProperty('code', 'NFSE_CANCELAMENTO_CONCORRENTE');
      release();
      expect((await attempt).error).toHaveProperty('code', 'NFSE_CANCELAMENTO_CONCORRENTE');
      expect((await invoice(f)).status).toBe('issued');
      expect(await db.appSetting.count({ where: { key: { startsWith: r.key + ':evento:' } } })).toBe(2);
    } finally { release(); await attempt; spy.mockRestore(); }
    const consulta = await a.reservar(f.contexto);
    expect((await confirm(a, consulta, f, deferido)).decisao.cancelada).toBe(false);
    expect((await invoice(f)).status).toBe('issued');
  });
  test('resposta isolada posterior não apaga conflito histórico sem correlação', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto);
    await confirm(a, r, f, evidence(f.contexto, '105105'));
    const novo = await a.reservar(f.contexto);
    const result = await confirm(a, novo, f, evidence(f.contexto, '105104'));
    expect(result.decisao).toMatchObject({ situacao: 'INCONCLUSIVO', cancelada: false });
    expect((await invoice(f)).status).toBe('issued');
    expect((await current(novo)).value.decisao.motivo).toBe('EVENTOS_FISCAIS_CONFLITANTES');
  });
  test('coleção inválida não custodia XML alheio nem parte anterior da coleção', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto);
    const ev = evidence(f.contexto), estranho = evidence({ ...f.contexto, companyId: 'outra' });
    await expect(confirm(a, r, f, { evidencias: [ev, estranho], completa: true, problemas: [] })).rejects.toHaveProperty('code');
    expect(await db.appSetting.count({ where: { key: { startsWith: r.key + ':evento:' } } })).toBe(0);
  });
  test('falha ao gravar julgamento reverte projeção e conserva custódia para recuperação', async () => {
    const f = await fixture(), a = criarPersistenciaCancelamento(db), r = await a.reservar(f.contexto), ev = evidence(f.contexto);
    const original = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementation(callback => original(tx => callback(new Proxy(tx, {
      get(target, prop) {
        if (prop !== 'appSetting') return target[prop];
        return new Proxy(tx.appSetting, { get(model, method) {
          if (method === 'upsert') return async args => {
            if (args.where.key.includes(':decisao:')) throw Error('Synthetic audit failure');
            return model.upsert(args);
          };
          return typeof model[method] === 'function' ? model[method].bind(model) : model[method];
        } });
      },
    }))));
    try { await expect(confirm(a, r, f, ev)).rejects.toThrow('Synthetic audit failure'); }
    finally { spy.mockRestore(); }
    expect((await invoice(f)).status).toBe('issued');
    expect(await db.appSetting.findUnique({ where: { key: r.key + ':evento:' + ev.hash } })).not.toBeNull();
    await confirm(a, r, f, ev);
    expect((await invoice(f)).status).toBe('cancelled');
  });

});
