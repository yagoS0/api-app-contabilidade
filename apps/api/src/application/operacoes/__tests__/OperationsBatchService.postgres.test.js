// Credenciais exclusivamente sintéticas; preparação, persistência e guarda são reais.
jest.mock('../../fiscal/serpro/SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { hasCertificate: true, document: '11111111000191' } })) }));
// Redireciona o singleton usado pelos consumidores reais ao mesmo banco descartável.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, { get: (_target, field) => {
  const value = mockPg[field]; return typeof value === 'function' ? value.bind(mockPg) : value;
} }) }));
jest.mock('axios', () => ({ __esModule: true, default: { request: jest.fn(() => { throw Error('HTTP sintético não configurado'); }) } }));
jest.mock('../../fiscal/serpro/SerproAuthService.js', () => ({ SerproAuthService: jest.fn().mockImplementation(() => ({
  authenticate: () => mockAuthenticate(), buildHttpsAgent: async () => null,
})) }));
jest.mock('../../guides/GuideStorageService.js', () => ({ GuideStorageService: { create: () => ({
  upload: async ({ key }) => ({ key, url: `https://storage.invalid/${key}` }),
}) } }));
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createOperationsBatchService } from '../OperationsBatchService.js';
import { lerOperacao, salvarOperacao } from '../OperationsService.js';
import { executarOperacao } from '../OperationsExecution.js';
import { listarEvidenciasOperacoes } from '../OperationsConsultas.js';
import { prepararSimplesConsistente } from '../../notas/apuracao/v2/PreparacaoAutomaticaSimples.js';
import { contextoOrigemCalculo } from '../../notas/apuracao/v2/RecuperacaoCalculo.js';
import { criarVinculoCalculo } from '../../notas/apuracao/v2/CalculoConfirmado.js';
import { autorizarDespacho, concluirChamada } from '../../fiscal/serpro/SerproCallGuard.js';
import { createManualTaskService } from '../../tasks/ManualTaskService.js';

const raw = process.env.TEST_CICLO_PG_URL || process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (!raw) throw new Error('Banco PostgreSQL descartável obrigatório para R2B.');
const url = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_governance_test') || url.searchParams.has('host')) throw new Error('Somente PostgreSQL descartável loopback.');
const pg = new PrismaClient({ datasources: { db: { url: raw } } });
const mockPg = pg;
const mockAuthenticate = jest.fn(async () => ({ accessToken: 'synthetic', jwtToken: 'synthetic' }));
const pa = '2026-10';
const clean = x => JSON.parse(JSON.stringify(x));
afterAll(() => pg.$disconnect());

async function fixture(run, { realTransmission = false } = {}) {
  const userId = randomUUID(), clientId = randomUUID(), ids = [randomUUID(), randomUUID()], companyIds = [randomUUID(), randomUUID()];
  const queue = [], batches = [], calls = [];
  const credentials = async () => ({ certificate: { hasCertificate: true, document: '11111111000191' } });
  const transport = jest.fn(async () => ({ ok: true })), auth = jest.fn(async () => {});
  const transmit = async args => {
    await args.antesDeTransmitir();
    const portal = await pg.portalClient.findUnique({ where: { id: args.portalClientId } });
    // Reserva fiscal fictícia persistida; a autorização final e seus locks são reais.
    const reservation = await pg.serproChamada.create({ data: { cnpj: portal.cnpj, portalClientId: portal.id, rota: '/Declarar', assinatura: randomUUID(), status: 'reservada', userId } });
    calls.push(reservation.id);
    const authorization = { id: reservation.id, inicio: Date.now() };
    await auth(args);
    await autorizarDespacho(authorization, pg);
    const result = await transport(args);
    await concluirChamada(authorization, { httpStatus: 200 }, pg);
    return result;
  };
  const tasks = createManualTaskService({ db: pg, schedule: fn => queue.push(fn) });
  const service = createOperationsBatchService({ db: pg, tasks, credentials, executionDeps: realTransmission ? {} : { transmit } });
  const preview = () => service.preview({ userId, competencia: pa });
  const accept = async (p, requestId = randomUUID()) => {
    const out = await service.accept({ userId, previewId: p.id, requestId, confirmCompetencia: pa }); batches.push(out.id); return out;
  };
  try {
    await pg.user.create({ data: { id: userId, email: `${userId}@example.test`, passwordHash: 'synthetic-no-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
    await pg.client.create({ data: { id: clientId, name: 'R2B SYNTHETIC', email: `${clientId}@example.test`, login: clientId, passwordHash: 'synthetic-no-login' } });
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], companyId = companyIds[i];
      const cnpj = (BigInt(`0x${randomUUID().replace(/-/g, '')}`) % 100000000000000n).toString().padStart(14, '0');
      await pg.company.create({ data: { id: companyId, clientId, cnpj, razaoSocial: 'R2B SYNTHETIC', atividades: [], regimeTributario: 'SIMPLES' } });
      await pg.portalClient.create({ data: { id, companyId, cnpj, razao: `R2B ${i}`, status: 'ATIVA' } });
      await pg.companyFirmAccess.create({ data: { companyId: id, userId, role: 'ACCOUNTANT', status: 'ACTIVE' } });
      await pg.cadastroFiscal.create({ data: { portalClientId: id, regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501', dataOpcaoSN: new Date('2020-01-01T00:00:00Z'), usaFatorR: false } });
      await pg.appSetting.create({ data: { key: `ciclo_simples_config:${id}`, value: { enabled: true, fontes: ['NFSE'] } } });
      await pg.appSetting.create({ data: { key: `serpro_procuration_status:${id}`, value: { cnpj, procuradorCnpj: '11111111000191', status: 'ATIVA', systems: ['PGDAS-D'], checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() } } });
      const input = { portalClientId: id, competencia: pa };
      const prepared = i === 0 ? await prepararSimplesConsistente(input, { db: pg }) : null;
      const context = prepared?.contexto || await contextoOrigemCalculo(input, pg);
      const proof = prepared ? { versao: 1, attemptId: randomUUID(), revision: 1, hash: prepared.hash, prova: prepared.prova } : undefined;
      const formulario = { atividades: prepared?.dados.atividades || [], folhaMensal12: prepared?.dados.folhaMensal12 || [], regimeApuracao: 'COMPETENCIA' };
      const v = criarVinculoCalculo({ ...input, contribuinteCnpj: cnpj, contratanteCnpj: '11111111000191', contextoOrigem: context,
        formulario, preparacaoAutomatica: proof });
      await pg.apuracaoSnapshot.create({ data: { ...input, estado: 'calculada', idempotencyKey: v.calculoId, dasSimuladoSerpro: 10, rbt12: 0, receitaPorTipo: {}, atividadesEscolhidas: clean(formulario.atividades), folhaMensal12: clean(formulario.folhaMensal12), simulacaoSerpro: { _portalCalculo: clean(v) } } });
      if (proof) await pg.appSetting.create({ data: { key: `ciclo_simples:${id}:${pa}`, value: { token: proof.attemptId, revision: 1, calculo: { calculoId: v.calculoId } } } });
      const op = await lerOperacao(pg, id, pa);
      expect(op.blocked).toBeNull(); expect(op.calculation.calculoId).toBe(v.calculoId);
      await salvarOperacao(pg, id, pa, userId, { action: 'confirm', expectedRevision: op.revision, requestId: randomUUID() });
    }
    await run({ ids, userId, queue, service, preview, accept, auth, transport, credentials, transmit, batches });
  } finally {
    // Limpeza somente dos IDs desta fixture; nunca esvaziar tabelas compartilhadas.
    const settings = await pg.appSetting.findMany({ select: { key: true, value: true } });
    const fiscalCalls = await pg.serproChamada.findMany({ where: { portalClientId: { in: ids } } });
    const owned = settings.filter(row => ids.some(id => row.key.includes(id)) || row.key.includes(userId)
      || [...calls, ...fiscalCalls.map(c => c.id)].some(id => row.key === `serpro_dispatch:${id}`)
      || row.value?.userId === userId || row.value?.after?.userId === userId);
    await pg.appSetting.deleteMany({ where: { key: { in: owned.map(r => r.key) } } });
    await pg.serproRespostaCache.deleteMany({ where: { chave: { in: fiscalCalls.map(c => c.assinatura) } } });
    await pg.serproChamada.deleteMany({ where: { portalClientId: { in: ids } } });
    await pg.guide.deleteMany({ where: { portalClientId: { in: ids } } });
    await pg.manualTask.deleteMany({ where: { ownerId: userId } });
    await pg.portalClient.deleteMany({ where: { id: { in: ids } } });
    await pg.company.deleteMany({ where: { id: { in: companyIds } } });
    await pg.client.deleteMany({ where: { id: clientId } });
    await pg.user.deleteMany({ where: { id: userId } });
  }
}

async function syntheticPdf(identity) {
  // PDF 1.4 ASCII sem compressão, xref em offsets de bytes. Identidade evita
  // reutilizar o mesmo hash de documento em empresas distintas (Guide.hash único).
  const text = `Documento sintetico R2B. Sem validade fiscal. ${identity}`.replace(/[()\\]/g, '_');
  const stream = `BT /F1 10 Tf 40 700 Td (${text}) Tj ET\n`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let document = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(document)); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(document, 'ascii').toString('base64');
}

const circularDiagnostic = c => c && ({ id: c.id, portalClientId: c.portalClientId, competencia: c.competencia,
  pgdasNumeroDeclaracao: c.pgdasNumeroDeclaracao, pgdasDeclaracaoFileId: c.pgdasDeclaracaoFileId,
  pgdasReciboFileId: c.pgdasReciboFileId, serproSyncStatus: c.serproSyncStatus, serproLastError: c.serproLastError });

test.each(['existing-declaration', 'changed-declaration-after-extract'])('PostgreSQL índice já declarado → extrato → DAS real: %s', async mode => fixture(async f => {
  const requests = [];
  const originals = new Map();
  for (const id of f.ids) originals.set(id, (await pg.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: pa } } })).simulacaoSerpro._portalCalculo);
  mockAuthenticate.mockReset();
  mockAuthenticate.mockImplementation(async () => ({ accessToken: 'synthetic', jwtToken: 'synthetic' }));
  axios.request.mockReset();
  axios.request.mockImplementation(async ({ data }) => {
    const portal = await pg.portalClient.findFirst({ where: { cnpj: data.contribuinte.numero } });
    expect(f.ids).toContain(portal.id);
    const service = data.pedidoDados.idServico;
    const pdf = await syntheticPdf(`${portal.id}-${service}`);
    requests.push({ id: portal.id, service });
    if (service === 'CONSDECLARACAO13') return { status: 200, data: { dados: JSON.stringify([{ numeroDeclaracao: `existing-${portal.id}` }]) } };
    if (service === 'CONSULTIMADECREC14') {
      const snapshot = await pg.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: portal.id, competencia: pa } } });
      expect(snapshot.estado).toBe('transmitida'); expect(snapshot.numeroDeclaracao).toBeNull();
      if (mode === 'changed-declaration-after-extract') mockAuthenticate.mockImplementationOnce(async () => {
        await pg.companyMonthlyCircular.update({ where: { portalClientId_competencia: { portalClientId: portal.id, competencia: pa } }, data: { pgdasNumeroDeclaracao: 'other-declaration' } });
        return { accessToken: 'synthetic', jwtToken: 'synthetic' };
      });
      return { status: 200, data: { dados: JSON.stringify({ numeroDeclaracao: `existing-${portal.id}`, declaracao: { pdf }, recibo: { pdf } }) } };
    }
    if (service === 'GERARDAS12' || service === 'GERARDASCOBRANCA17') {
      expect(mode).toBe('existing-declaration');
      return { status: 200, data: { dados: JSON.stringify({ pdf, numeroDocumento: `test-${portal.id}`, valorTotal: 10, dataVencimento: '20261120' }) } };
    }
    throw Error(`Transporte inesperado: ${service}`);
  });
  await f.accept(await f.preview()); await f.queue[0]();
  expect(requests.filter(r => r.service === 'TRANSDECLARACAO11')).toHaveLength(0);
  for (const id of f.ids) {
    const snapshot = await pg.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: pa } } });
    expect(snapshot.simulacaoSerpro._portalCalculo).toEqual(originals.get(id));
    expect(requests.filter(r => r.id === id && r.service === 'CONSULTIMADECREC14')).toHaveLength(1);
    const attempt = (await pg.appSetting.findMany({ where: { key: { startsWith: `operations_execution:${id}:${pa}:` } } }))[0].value;
    // Apenas fixtures sintéticas: preservar o motivo antes da asserção, sem relaxá-la.
    console.info('R2B_DECLARACAO_DIAGNOSTICO', JSON.stringify({ mode, id, requests: requests.filter(r => r.id === id), attempt,
      circular: circularDiagnostic(await pg.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: pa } } })),
      fiscal: await pg.serproChamada.findMany({ where: { portalClientId: id }, select: { rota: true, status: true, erroCodigo: true } }) }));
    // Expor o erro original da sincronização mesmo com Jest --silent.
    const circularState = circularDiagnostic(await pg.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: pa } } }));
    expect(circularState).toMatchObject({ serproSyncStatus: 'SUCCESS', serproLastError: null });
    expect(attempt).toMatchObject({ evolucaoDocumental: { documento: { numeroDeclaracao: `existing-${id}` } } });
    const dasRequests = requests.filter(r => r.id === id && ['GERARDAS12', 'GERARDASCOBRANCA17'].includes(r.service));
    if (mode === 'existing-declaration') {
      expect(dasRequests).toHaveLength(1);
      expect(attempt.status).toBe('DONE'); expect(attempt.documentos.guia.ok).toBe(true);
      expect(await pg.guide.count({ where: { portalClientId: id, competencia: pa, tipo: 'SIMPLES', status: 'PROCESSED' } })).toBe(1);
    } else {
      expect(dasRequests).toHaveLength(0);
      expect(attempt.documentos.guia).toMatchObject({ ok: false, skipped: true });
      expect(await pg.guide.count({ where: { portalClientId: id, competencia: pa } })).toBe(0);
    }
    expect(await pg.accountingEntry.count({ where: { portalClientId: id } })).toBe(0);
  }
}, { realTransmission: true }), 120000);

test.each(['complete', 'pause-between-documents'])('PostgreSQL consumidor integral R2A/v1: %s', async mode => fixture(async f => {
  const requests = [], transmitted = new Set();
  mockAuthenticate.mockReset();
  mockAuthenticate.mockImplementation(async () => ({ accessToken: 'synthetic', jwtToken: 'synthetic' }));
  axios.request.mockReset();
  axios.request.mockImplementation(async ({ data }) => {
    const portal = await pg.portalClient.findFirst({ where: { cnpj: data.contribuinte.numero } });
    expect(f.ids).toContain(portal.id);
    const service = data.pedidoDados.idServico;
    const pdf = await syntheticPdf(`${portal.id}-${service}`);
    requests.push({ id: portal.id, service });
    if (service === 'TRANSDECLARACAO11') {
      expect(JSON.parse(data.pedidoDados.dados).indicadorTransmissao).toBe(true);
      transmitted.add(portal.id);
      return { status: 200, data: { dados: JSON.stringify({ idDeclaracao: `declaration-${portal.id}`, valoresDevidos: [{ codigoTributo: '1001', valor: 10 }] }) } };
    }
    if (service === 'CONSDECLARACAO13') {
      return { status: 200, data: { dados: JSON.stringify(transmitted.has(portal.id) ? [{ numeroDeclaracao: `declaration-${portal.id}` }] : []) } };
    }
    if (service === 'CONSULTIMADECREC14') {
      const saved = await pg.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: portal.id, competencia: pa } } });
      expect(saved.estado).toBe('transmitida');
      expect(saved.numeroDeclaracao).toBe(`declaration-${portal.id}`);
      // A próxima autorização ocorre após a persistência do extrato. O retorno
      // desta chamada permanece válido mesmo se o operador pausar durante auth seguinte.
      if (mode === 'pause-between-documents') mockAuthenticate.mockImplementationOnce(async () => {
        const policy = { paused: true, version: 1, reason: 'Pausa sintética entre documentos', updatedBy: f.userId, updatedAt: new Date().toISOString(), resumedAt: null };
        await pg.appSetting.upsert({ where: { key: `company_automation_policy:${portal.id}` },
          create: { key: `company_automation_policy:${portal.id}`, value: policy }, update: { value: policy } });
        return { accessToken: 'synthetic', jwtToken: 'synthetic' };
      });
      return { status: 200, data: { dados: JSON.stringify({ numeroDeclaracao: `declaration-${portal.id}`, declaracao: { pdf }, recibo: { pdf } }) } };
    }
    throw Error(`Transporte inesperado: ${service}`);
  });
  if (mode === 'complete') for (const id of f.ids) await pg.guide.create({ data: { portalClientId: id, competencia: pa, tipo: 'SIMPLES', status: 'PROCESSED', pdfBytes: Buffer.from('synthetic-existing-guide'), source: 'LOCAL' } });
  const accepted = await f.accept(await f.preview());
  await f.queue[0]();
  const result = await f.service.get({ userId: f.userId, batchId: accepted.id });
  expect(result.items).toHaveLength(2);
  for (const id of f.ids) {
    const snapshot = await pg.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: pa } } });
    expect(snapshot.estado).toBe('transmitida');
    expect(snapshot.numeroDeclaracao).toBe(`declaration-${id}`);
    const circular = await pg.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: pa } } });
    console.info('R2B_PAUSA_DIAGNOSTICO', JSON.stringify({ mode, id, requests: requests.filter(r => r.id === id), circular: circularDiagnostic(circular),
      attempt: (await pg.appSetting.findMany({ where: { key: { startsWith: `operations_execution:${id}:${pa}:` } } }))[0]?.value }));
    expect(circular.pgdasDeclaracaoFileId).toBeTruthy(); expect(circular.pgdasReciboFileId).toBeTruthy();
    expect(requests.filter(r => r.id === id && r.service === 'TRANSDECLARACAO11')).toHaveLength(1);
    expect(requests.filter(r => r.id === id && r.service === 'CONSULTIMADECREC14')).toHaveLength(1);
    expect(await pg.accountingEntry.count({ where: { portalClientId: id } })).toBe(0);
    const attempt = (await pg.appSetting.findMany({ where: { key: { startsWith: `operations_execution:${id}:${pa}:` } } }))[0].value;
    expect(attempt.status).toBe('DONE'); expect(attempt.documentos.extrato.ok).toBe(true);
    if (mode === 'complete') {
      expect(attempt.documentos.guia).toMatchObject({ ok: true, reutilizado: true }); expect(attempt.message).toBeNull();
    } else {
      expect(attempt.documentos.guia).toMatchObject({ ok: false, skipped: true, code: 'AUTOMACAO_EMPRESA_PAUSADA' });
      expect(attempt.message).toMatch(/pausada/);
    }
  }
  expect(requests.some(r => ['GERARDAS12', 'GERARDASCOBRANCA17'].includes(r.service))).toBe(false);
  expect((await pg.manualTask.findUnique({ where: { id: accepted.taskId } })).status).toBe(mode === 'complete' ? 'done' : 'partial');
  const count = requests.length;
  await f.service.get({ userId: f.userId, batchId: accepted.id });
  expect(requests).toHaveLength(count);
}, { realTransmission: true }), 120000);

test('PostgreSQL: R2A e v1 reais chegam ao despacho real; aceite concorrente, replay e tarefa durável', async () => fixture(async f => {
  const evidence = await pg.$transaction(tx => listarEvidenciasOperacoes(tx, f.ids, pa, { rootDb: pg }), { isolationLevel: 'RepeatableRead' });
  expect(evidence.items.every(i => i.status === 'CONFIRMED' && !i.blocked)).toBe(true);
  const p = await f.preview(); expect(p.items).toHaveLength(2);
  const requestId = randomUUID();
  const results = await Promise.allSettled([f.accept(p, requestId), f.accept(p, requestId)]);
  expect(results.some(r => r.status === 'fulfilled')).toBe(true);
  for (const r of results.filter(r => r.status === 'rejected')) expect(r.reason.code).toBe('P2034');
  const accepted = await f.accept(p, requestId);
  expect(f.queue).toHaveLength(1); expect(f.transport).not.toHaveBeenCalled();
  expect(await pg.manualTask.count({ where: { id: accepted.taskId, ownerId: f.userId } })).toBe(1);
  await f.queue[0]();
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect((await f.service.get({ userId: f.userId, batchId: accepted.id })).items.map(i => i.state)).toEqual(['DONE', 'DONE']);
  expect((await pg.manualTask.findUnique({ where: { id: accepted.taskId } })).status).toBe('done');
  const other = await f.preview(); await expect(f.accept(other, requestId)).rejects.toThrow('outra liberação');
  // Uma nova instância não drena lote nem repete transporte.
  const restarted = createOperationsBatchService({ db: pg });
  await restarted.get({ userId: f.userId, batchId: accepted.id }); expect(f.transport).toHaveBeenCalledTimes(2);
}), 60000);

test.each(['access', 'company', 'proof'])('PostgreSQL: alteração %s durante auth impede transporte pela guarda real', async kind => fixture(async f => {
  const accepted = await f.accept(await f.preview());
  f.auth.mockImplementation(async args => {
    if (kind === 'access') await pg.user.update({ where: { id: f.userId }, data: { status: 'inactive' } });
    if (kind === 'company') await pg.appSetting.create({ data: { key: `company_automation_policy:${args.portalClientId}`, value: { paused: true, version: 1, reason: 'Teste local', updatedBy: f.userId, updatedAt: new Date().toISOString(), resumedAt: null } } });
    if (kind === 'proof') await pg.cadastroFiscal.update({ where: { portalClientId: args.portalClientId }, data: { usaFatorR: true } });
  });
  await f.queue[0](); expect(f.transport).not.toHaveBeenCalled();
  expect(await pg.appSetting.count({ where: { key: { startsWith: 'serpro_dispatch:' }, value: { path: ['companyId'], equals: f.ids[0] } } })).toBe(0);
  expect((await pg.manualTask.findUnique({ where: { id: accepted.taskId } })).status).not.toBe('done');
}), 60000);

test('PostgreSQL: lote e manual concorrentes compartilham uma única reserva por liberação', async () => fixture(async f => {
  const accepted = await f.accept(await f.preview());
  const op = await lerOperacao(pg, f.ids[0], pa);
  await Promise.allSettled([f.queue[0](), executarOperacao(pg, { companyId: f.ids[0], competencia: pa, userId: f.userId, revision: op.revision }, { credentials: f.credentials, transmit: async () => { await f.transport({ portalClientId: f.ids[0] }); return { ok: true }; } })]);
  expect(f.transport.mock.calls.filter(([args]) => args.portalClientId === f.ids[0]).length).toBeLessThanOrEqual(1);
  expect(await pg.appSetting.count({ where: { key: { startsWith: `operations_execution:${f.ids[0]}:${pa}:` } } })).toBe(1);
  expect((await f.service.get({ userId: f.userId, batchId: accepted.id })).items).toHaveLength(2);
}), 60000);

test('PostgreSQL: falha da auditoria reverte liberações e recibo antes de agendar', async () => fixture(async f => {
  const p = await f.preview();
  const broken = new Proxy(pg, { get(target, prop) {
    if (prop === '$transaction') return (fn, options) => pg.$transaction(tx => fn(new Proxy(tx, { get(inner, field) {
      if (field === 'appSetting') return { ...inner.appSetting, create: args => {
        if (args.data.key.startsWith('operations_batch:') && args.data.key.includes(':audit:')) throw new Error('audit-failed');
        return inner.appSetting.create(args);
      } };
      return typeof inner[field] === 'function' ? inner[field].bind(inner) : inner[field];
    } })), options);
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  } });
  const tasks = { start: jest.fn() };
  const service = createOperationsBatchService({ db: broken, tasks, credentials: f.credentials });
  const requestId = randomUUID();
  await expect(service.accept({ userId: f.userId, previewId: p.id, requestId, confirmCompetencia: pa })).rejects.toThrow('audit-failed');
  for (const id of f.ids) expect((await lerOperacao(pg, id, pa)).status).toBe('CONFIRMED');
  expect(await pg.appSetting.count({ where: { key: `operations_batch_request:${f.userId}:${requestId}` } })).toBe(0);
  expect(tasks.start).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
}), 60000);
