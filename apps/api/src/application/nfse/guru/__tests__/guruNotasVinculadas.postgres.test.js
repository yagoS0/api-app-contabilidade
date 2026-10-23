jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { criarGuruConferencia } from '../GuruConferenciaService.js';

test('PG descartável: vínculo concorrente, reconferência, isolamento, download local e rollback atômico', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('ALTAN_GOVERNANCE_TEST_DATABASE_URL obrigatória');
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) throw Error('Banco descartável recusado');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const suffix = randomUUID(), companyId = `guru-nota-${suffix}`, outra = `guru-nota-outra-${suffix}`,
    userId = `guru-nota-user-${suffix}`, clientId = `guru-nota-client-${suffix}`;
  const env = { NODE_ENV: 'test', GURU_CONFERENCIA_COMPANY_ID: companyId, GURU_CONFERENCIA_ACCOUNT_ID: suffix };
  const service = criarGuruConferencia({ db, env });
  const args = { companyId, userId };
  const blocked = jest.fn(() => { throw Error('Rede externa proibida'); });
  const spies = [jest.spyOn(http, 'request').mockImplementation(blocked), jest.spyOn(https, 'request').mockImplementation(blocked)];
  if (global.fetch) spies.push(jest.spyOn(global, 'fetch').mockImplementation(blocked));
  const cnpj = suffix.replace(/-/g, '').slice(0, 14).split('').map(c => parseInt(c, 16) % 10).join('');
  const chave = '7'.repeat(50);
  const xml = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}"><nNFSe>7</nNFSe><cStat>100</cStat><DPS><infDPS><tpAmb>1</tpAmb><dCompet>2026-10-01</dCompet><prest><CNPJ>${cnpj}</CNPJ></prest><toma><CPF>12345678909</CPF></toma><valores><vServPrest><vServ>100.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
  try {
    await db.client.create({ data: { id: clientId, name: 'Fixture', email: `${suffix}@example.invalid`, login: suffix, passwordHash: 'inutilizavel' } });
    await db.user.create({ data: { id: userId, email: `${suffix}@example.invalid`, passwordHash: 'inutilizavel', role: 'contador', status: 'active' } });
    await db.company.createMany({ data: [companyId, outra].map(id => ({ id, clientId, cnpj: id === companyId ? cnpj : id, razaoSocial: 'Somente fixture', atividades: [] })) });
    const nota = await db.serviceInvoice.create({ data: { companyId, tomadorDoc: '12345678909', tomadorNome: 'Fixture', valorServicos: 100,
      status: 'issued', numeroNfse: '7', chaveAcesso: chave, xml } });
    const { item } = await service.preparar({ ...args, body: { transacaoId: suffix, referenciaOrigem: 'Fixture local', valorCentavos: 10000, moeda: 'BRL', situacaoPagamento: 'DESCONHECIDO' } });
    const info = await service.obterNota({ ...args, notaId: nota.id });
    const command = { ...args, id: item.id, body: { versao: item.versao, hash: item.hash, notaId: nota.id, notaHash: info.hash, confirmada: true } };
    const resultados = await Promise.all([service.vincularNota(command), service.vincularNota(command)]);
    expect(resultados.filter(r => !r.repetida)).toHaveLength(1);
    expect((await service.obter({ ...args, id: item.id })).historico.filter(h => h.evento === 'NOTA_VINCULADA')).toHaveLength(1);
    expect(await db.serviceInvoice.findUnique({ where: { id: nota.id } })).toEqual(nota);
    const arquivo = await service.documentoNota({ ...args, id: item.id, notaId: nota.id, formato: 'xml' });
    expect(arquivo.bytes.toString()).toBe(xml);
    const pdf = await service.documentoNota({ ...args, id: item.id, notaId: nota.id, formato: 'danfse' });
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
    const deOutra = await db.serviceInvoice.create({ data: { companyId: outra, tomadorDoc: '12345678909', tomadorNome: 'Fixture', valorServicos: 100, status: 'issued', numeroNfse: '7', chaveAcesso: chave, xml } });
    await expect(service.obterNota({ ...args, notaId: deOutra.id })).rejects.toMatchObject({ status: 404 });
    await expect(service.vincularNota({ ...command, body: { ...command.body, notaId: deOutra.id } })).rejects.toMatchObject({ status: 404 });

    await db.serviceInvoice.update({ where: { id: nota.id }, data: { valorServicos: 101, xml: xml.replace('100.00', '101.00') } });
    await expect(service.vincularNota(command)).rejects.toMatchObject({ code: 'guru_revisao_desatualizada' });
    expect((await service.obter({ ...args, id: item.id })).notas[0].conferencia).toBe('RECONFERIR');
    const atual = await service.obterNota({ ...args, notaId: nota.id });
    const falhando = criarGuruConferencia({ env, db: { $transaction: (fn, opts) => db.$transaction(tx => fn(new Proxy(tx, {
      get(target, prop) {
        if (prop === 'appSetting') return new Proxy(target.appSetting, { get(model, method) {
          if (method === 'update') return async input => { await model.update(input); throw Error('Falha após auditoria'); };
          return typeof model[method] === 'function' ? model[method].bind(model) : model[method];
        } });
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      },
    })), opts) } });
    const antes = await service.obter({ ...args, id: item.id });
    await expect(falhando.vincularNota({ ...command, body: { ...command.body, notaHash: atual.hash } })).rejects.toThrow('Falha após auditoria');
    expect(await service.obter({ ...args, id: item.id })).toEqual(antes);
    await service.vincularNota({ ...command, body: { ...command.body, notaHash: atual.hash } });
    await db.serviceInvoice.update({ where: { id: nota.id }, data: { status: 'cancelled' } });
    await expect(service.documentoNota({ ...args, id: item.id, notaId: nota.id, formato: 'xml' })).rejects.toMatchObject({ status: 409 });
    const portal = await db.portalClient.create({ data: { companyId, cnpj, razao: 'Fixture portal' } });
    const outroPortal = await db.portalClient.create({ data: { companyId: outra, cnpj: outra, razao: 'Outra fixture' } });
    const portalData = { clientId: portal.id, type: 'NFSE', papel: 'EMIT', numero: '7', chaveAcesso: chave,
      competencia: new Date('2026-10-01'), status: 'EMITIDA', statusEfetivo: 'autorizada', total: 100,
      emitenteDoc: cnpj, tomadorDoc: '12345678909', tomadorNome: 'Tomador local', xmlRaw: xml };
    const fiscal = await db.portalInvoice.create({ data: portalData });
    const estrangeira = await db.portalInvoice.create({ data: { ...portalData, clientId: outroPortal.id } });
    await expect(service.obterNota({ ...args, notaId: `portal:${estrangeira.id}` })).rejects.toMatchObject({ status: 404 });
    const busca = await service.buscarNotas({ ...args, query: { busca: 'Tomador local' } });
    expect(busca).toMatchObject({ total: 1, items: [{ id: `portal:${fiscal.id}`, origem: 'PortalInvoice', vinculavel: true, competencia: '2026-10-01' }] });
    const pcommand = { ...command, body: { ...command.body, notaId: busca.items[0].id, notaHash: busca.items[0].hash } };
    const antesPortal = await service.obter({ ...args, id: item.id });
    await expect(falhando.vincularNota(pcommand)).rejects.toThrow('Falha após auditoria');
    expect(await service.obter({ ...args, id: item.id })).toEqual(antesPortal);
    const concorrentes = await Promise.all([service.vincularNota(pcommand), service.vincularNota(pcommand)]);
    expect(concorrentes.filter(r => !r.repetida)).toHaveLength(1);
    expect((await service.listar(args)).resumo.notasVinculadas).toBe(1); // mesma chave, duas fontes
    expect((await service.documentoNota({ ...args, id: item.id, notaId: pcommand.body.notaId, formato: 'xml' })).bytes.toString()).toBe(xml);
    expect((await service.documentoNota({ ...args, id: item.id, notaId: pcommand.body.notaId, formato: 'danfse' })).bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(await db.portalInvoice.findUnique({ where: { id: fiscal.id } })).toEqual(fiscal);
    // Um evento salvo já impede confirmação, mesmo se a projeção de status ainda não mudou.
    await db.portalInvoiceEvent.create({ data: { clientId: portal.id, invoiceId: fiscal.id, type: 'cancelamento', date: new Date(), nSeqEvento: 1 } });
    expect((await service.obter({ ...args, id: item.id })).notas.find(n => n.id === pcommand.body.notaId).conferencia).toBe('RECONFERIR');
    await expect(service.vincularNota(pcommand)).rejects.toMatchObject({ code: 'guru_revisao_desatualizada' });
    const cancelada = await service.obterNota({ ...args, notaId: pcommand.body.notaId });
    expect(cancelada.vinculavel).toBe(false);
    await expect(service.vincularNota({ ...pcommand, body: { ...pcommand.body, notaHash: cancelada.hash } })).rejects.toMatchObject({ code: 'guru_documento_fiscal_invalido' });
    await expect(service.documentoNota({ ...args, id: item.id, notaId: pcommand.body.notaId, formato: 'danfse' })).rejects.toMatchObject({ status: 409 });
    await db.portalInvoice.update({ where: { id: fiscal.id }, data: { status: 'CANCELADA', statusEfetivo: 'cancelada' } });
    await db.portalInvoiceEvent.create({ data: { clientId: portal.id, invoiceId: fiscal.id, type: 'canc_por_substituicao', chaveSubstituta: '8'.repeat(50), date: new Date(), nSeqEvento: 2 } });
    expect(await service.obterNota({ ...args, notaId: pcommand.body.notaId })).toMatchObject({ estado: 'substituida', vinculavel: false });
    await db.portalInvoice.createMany({ data: Array.from({ length: 22 }, (_, i) => ({ ...portalData, numero: String(100 + i), chaveAcesso: null, xmlRaw: null, tomadorNome: 'Busca paginada' })) });
    const primeira = await service.buscarNotas({ ...args, query: { busca: 'Busca paginada' } });
    const segunda = await service.buscarNotas({ ...args, query: { busca: 'Busca paginada', pagina: 2 } });
    expect(primeira.total).toBe(22); expect(primeira.items).toHaveLength(20);
    expect(segunda.total).toBe(22); expect(segunda.items).toHaveLength(2);
    expect(new Set([...primeira.items, ...segunda.items].map(n => n.id)).size).toBe(22);

    // Duas conexões reais: uma substituta chega enquanto o vínculo está em curso,
    // inclusive sem captura da original. A barreira evita depender de sleep/timing.
    for (const momento of ['antesDaGravacao', 'aposGravacao']) {
      const chaveOriginal = (momento === 'antesDaGravacao' ? '5' : '6').repeat(50);
      const original = await db.serviceInvoice.create({ data: { companyId, tomadorDoc: '12345678909', tomadorNome: 'Fixture',
        valorServicos: 100, status: 'issued', numeroNfse: '7', chaveAcesso: chaveOriginal, xml: xml.replace(chave, chaveOriginal) } });
      const preparada = await service.preparar({ ...args, body: { transacaoId: `${suffix}-${momento}`, referenciaOrigem: 'Concorrência local',
        valorCentavos: 10000, moeda: 'BRL', situacaoPagamento: 'DESCONHECIDO' } });
      const antes = await service.obter({ ...args, id: preparada.item.id });
      const revisao = await service.obterNota({ ...args, notaId: original.id });
      let chegou, liberar;
      const barreira = new Promise(resolve => { chegou = resolve; });
      const continuar = new Promise(resolve => { liberar = resolve; });
      let pausou = false;
      const intercalado = criarGuruConferencia({ env, db: { $transaction: (fn, opts) => db.$transaction(tx => fn(new Proxy(tx, {
        get(target, prop) {
          if (prop === 'appSetting') return new Proxy(target.appSetting, { get(model, method) {
            const alvo = momento === 'antesDaGravacao' ? 'findUnique' : 'update';
            if (method === alvo) return async input => {
              const resultado = await model[method](input);
              if (!pausou) { pausou = true; chegou(); await continuar; }
              return resultado;
            };
            return typeof model[method] === 'function' ? model[method].bind(model) : model[method];
          } });
          return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
        },
      })), { ...opts, timeout: 10000 }) } });
      const tentativa = intercalado.vincularNota({ ...args, id: preparada.item.id, body: { versao: preparada.item.versao,
        hash: preparada.item.hash, notaId: original.id, notaHash: revisao.hash, confirmada: true } })
        .then(value => ({ value }), error => ({ error }));
      await barreira;
      try {
        await db.portalInvoice.create({ data: { ...portalData, chaveAcesso: randomUUID().replace(/-/g, ''),
          chaveSubstituida: chaveOriginal, numero: '8', xmlRaw: null } });
      } finally { liberar(); }
      const resultado = await tentativa;
      const depois = await service.obter({ ...args, id: preparada.item.id });
      if (momento === 'antesDaGravacao') {
        expect(resultado.error).toMatchObject({ code: 'guru_revisao_desatualizada' });
        expect(depois).toEqual(antes); // rollback, inclusive auditoria
      } else {
        expect(resultado.error).toBeUndefined();
        expect(resultado.value.item.notas[0].conferencia).toBe('RECONFERIR');
        expect(depois.notas[0].conferencia).toBe('RECONFERIR');
        expect(depois.historico.filter(h => h.evento === 'NOTA_VINCULADA')).toHaveLength(1);
      }
      const atualizada = await service.obterNota({ ...args, notaId: original.id });
      expect(atualizada.vinculavel).toBe(false); expect(atualizada.hash).not.toBe(revisao.hash);
      expect(await db.serviceInvoice.findUnique({ where: { id: original.id } })).toEqual(original);
      expect(await db.portalInvoice.findFirst({ where: { clientId: portal.id, chaveAcesso: chaveOriginal } })).toBeNull();
      for (const formato of ['xml', 'danfse']) await expect(service.documentoNota({ ...args, id: preparada.item.id,
        notaId: original.id, formato })).rejects.toMatchObject({ status: 409 });
    }
    expect(blocked).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
    await db.appSetting.deleteMany({ where: { value: { path: ['companyId'], equals: companyId } } });
    await db.serviceInvoice.deleteMany({ where: { companyId: { in: [companyId, outra] } } });
    await db.portalInvoice.deleteMany({ where: { client: { companyId: { in: [companyId, outra] } } } });
    await db.portalClient.deleteMany({ where: { companyId: { in: [companyId, outra] } } });
    await db.company.deleteMany({ where: { id: { in: [companyId, outra] } } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.client.deleteMany({ where: { id: clientId } });
    await db.$disconnect();
  }
}, 30000);
