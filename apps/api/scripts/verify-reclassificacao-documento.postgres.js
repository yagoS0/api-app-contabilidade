import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
// Executar explicitamente com Jest --testMatch '**/scripts/verify-reclassificacao-documento.postgres.js'.
// Não integra a descoberta unitária; exige PostgreSQL descartável, nunca ignora cenários por ambiente.
import { criarReclassificarDocumentoGuia } from '../src/application/guides/ReclassificarDocumentoGuiaService.js';
import { registrarEnvio } from '../src/application/guides/EnvioGuiaService.js';
import { atualizarGuiaComEvidencia } from '../src/application/guides/atualizarGuiaComEvidencia.js';

const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (!raw) throw new Error('ALTAN_GOVERNANCE_TEST_DATABASE_URL obrigatório.');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_governance_test')) throw new Error('Somente banco descartável loopback.');
const db = new PrismaClient({ datasources: { db: { url: raw } } });
const prefix = `reclassificar-${randomUUID()}`, companyId = prefix;
const user = { id: `${prefix}-user`, accountType: 'FIRM' };
const service = criarReclassificarDocumentoGuia({ db });
const ids = [];
beforeAll(async () => {
  await db.user.create({ data: { ...user, email: `${prefix}@example.invalid`, passwordHash: 'fixture-inutilizavel' } });
  await db.portalClient.create({ data: { id: companyId, cnpj: prefix, razao: 'Empresa fictícia' } });
  await db.companyFirmAccess.create({ data: { companyId, userId: user.id, role: 'ACCOUNTANT' } });
});
afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { contains: prefix } } });
  await db.companyDocument.deleteMany({ where: { portalClientId: companyId } });
  await db.guide.deleteMany({ where: { id: { in: ids } } });
  await db.portalClient.delete({ where: { id: companyId } });
  await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
});
async function fixture(extra = {}) {
  const id = `${prefix}-${ids.length}`, pdfBytes = Buffer.from(`%PDF-1.4\nFolha fictícia ${id}`);
  ids.push(id);
  return db.guide.create({ data: { id, portalClientId: companyId, tipo: 'OUTRA', status: 'PROCESSED', source: 'LOCAL', competencia: '2026-09', pdfBytes, hash: createHash('sha256').update(pdfBytes).digest('hex'), ...extra } });
}
async function pedido(g) {
  const previa = await service.previa(companyId, g.id, user);
  return { confirmado: true, motivo: 'Documento de folha conferido pelo contador', categoria: 'FOLHA', revisao: previa.revisao, idempotencyKey: randomUUID() };
}
test('preserva PDF/envio e pagamento; cria documento e auditoria uma vez', async () => {
  const g = await fixture();
  const envio = await db.envioGuia.create({ data: { guideId: g.id, canal: 'WHATSAPP', status: 'entregue', providerMessageId: 'wamid.ficticio' } });
  const input = await pedido(g), result = await service.confirmar(companyId, g.id, user, input);
  expect((await service.confirmar(companyId, g.id, user, input)).repetido).toBe(true);
  const atual = await db.guide.findUnique({ where: { id: g.id } });
  expect(Buffer.from(atual.pdfBytes)).toEqual(Buffer.from(g.pdfBytes));
  expect(atual).toMatchObject({ hash: g.hash, status: 'DOCUMENTO_NAO_ARRECADATORIO', paymentStatus: 'OPEN', baixada: false });
  expect(await db.envioGuia.findUnique({ where: { id: envio.id } })).toEqual(envio);
  expect(await db.companyDocument.findUnique({ where: { id: result.documentId } })).toMatchObject({ portalClientId: companyId, fileKey: `guia-documento:${g.id}` });
  expect(await db.appSetting.count({ where: { key: { contains: g.id } } })).toBe(1);
  await expect(atualizarGuiaComEvidencia(db, g.id, () => ({ paymentStatus: 'PAID' }))).rejects.toMatchObject({ code: 'DOCUMENTO_NAO_ARRECADATORIO' });
  await expect(registrarEnvio({ guideId: g.id, canal: 'WHATSAPP', destino: 'ficticio', tx: db })).rejects.toMatchObject({ code: 'DOCUMENTO_NAO_ARRECADATORIO' });
});
test('ACL, vínculo fiscal, PDF divergente e envio incerto não alteram documento', async () => {
  const g = await fixture();
  await expect(service.previa(companyId, g.id, { ...user, accountType: 'CLIENT' })).rejects.toMatchObject({ status: 403 });
  await expect(service.previa('outra', g.id, user)).rejects.toMatchObject({ status: 403 });
  for (const extra of [{ lancamentoId: 'vinculo' }, { pdfBytes: Buffer.from('%PDF-modificado') }, { emailStatus: 'SENDING' }, { paymentStatus: 'PAID' }]) {
    const item = await fixture(extra), input = await pedido(item);
    await expect(service.confirmar(companyId, item.id, user, input)).rejects.toMatchObject({ code: 'RECLASSIFICACAO_BLOQUEADA' });
    expect((await db.guide.findUnique({ where: { id: item.id } })).status).toBe('PROCESSED');
  }
});
test('falha da auditoria desfaz documento e reclassificação', async () => {
  const g = await fixture(), input = await pedido(g);
  const broken = { $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) { return prop === 'appSetting' ? { findUnique: target.appSetting.findUnique, create: () => { throw Error('audit-failed'); } } : target[prop]; } })), options) };
  await expect(criarReclassificarDocumentoGuia({ db: broken }).confirmar(companyId, g.id, user, input)).rejects.toThrow('audit-failed');
  expect((await db.guide.findUnique({ where: { id: g.id } })).status).toBe('PROCESSED');
  expect(await db.companyDocument.count({ where: { fileKey: `guia-documento:${g.id}` } })).toBe(0);
});
test('corrida de reclassificação e reserva nunca permite os dois efeitos', async () => {
  const g = await fixture(), input = await pedido(g);
  const outcomes = await Promise.allSettled([
    service.confirmar(companyId, g.id, user, input),
    registrarEnvio({ guideId: g.id, canal: 'WHATSAPP', destino: 'ficticio', tx: db }),
  ]);
  expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  const atual = await db.guide.findUnique({ where: { id: g.id } });
  const reservados = await db.envioGuia.count({ where: { guideId: g.id, status: 'pendente' } });
  expect(atual.status === 'DOCUMENTO_NAO_ARRECADATORIO' && reservados > 0).toBe(false);
});
test.each(['EMAIL', 'PAGAMENTO'])('corrida com %s conserva uma única decisão', async canal => {
  const g = await fixture(), input = await pedido(g);
  const outcomes = await Promise.allSettled([
    service.confirmar(companyId, g.id, user, input),
    canal === 'EMAIL'
      ? registrarEnvio({ guideId: g.id, canal, destino: 'fixture@example.invalid', tx: db })
      : atualizarGuiaComEvidencia(db, g.id, () => ({ paymentStatus: 'PAID', paymentStatusSource: 'MANUAL' })),
  ]);
  expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  const atual = await db.guide.findUnique({ where: { id: g.id } });
  expect(atual.status === 'DOCUMENTO_NAO_ARRECADATORIO' && atual.paymentStatus === 'PAID').toBe(false);
  if (atual.status === 'DOCUMENTO_NAO_ARRECADATORIO') expect(await db.envioGuia.count({ where: { guideId: g.id } })).toBe(0);
});
test('prévia obsoleta e idempotência divergente não sobrescrevem a revisão', async () => {
  const g = await fixture(), input = await pedido(g);
  await db.guide.update({ where: { id: g.id }, data: { extracted: { revisado: true } } });
  await expect(service.confirmar(companyId, g.id, user, input)).rejects.toMatchObject({ code: 'GUIA_ALTERADA' });
  const fresh = await pedido(g);
  await service.confirmar(companyId, g.id, user, fresh);
  await expect(service.confirmar(companyId, g.id, user, { ...fresh, categoria: 'PRO_LABORE' })).rejects.toMatchObject({ code: 'IDEMPOTENCIA_DIVERGENTE' });
});
