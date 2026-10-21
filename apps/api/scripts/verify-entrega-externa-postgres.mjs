import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const url = new URL(process.argv[2] || 'invalid:');
assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55490');
assert.equal(url.username, 'altan_guias_test'); assert.equal(url.pathname, '/altan_envio_externo_20261021_governance_test');
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: 'test', LOG_LEVEL: 'fatal', INTEGRACAO_WHATSAPP: '0', INTEGRACAO_FISCAL_LEADS: '0' });
let rede = 0; const deny = () => { rede++; throw Error('Rede externa proibida'); };
globalThis.fetch = http.get = http.request = https.get = https.request = deny;
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { criarEntregaExternaGuia, revisaoEntrega, reservarSemEntregaExterna } = await import('../src/application/guides/EntregaExternaGuiaService.js');
const { enviosPorGuia, foiEnviadaComLegado } = await import('../src/application/guides/EnvioGuiaService.js');
const { conferirEntregaGuiaWhatsapp } = await import('../src/application/guides/EntregaGuiaWhatsappService.js');
const prefix = `externa-${randomUUID()}`;
let company, user;
try {
  company = await db.portalClient.create({ data: { cnpj: prefix, razao: 'TESTE SINTETICO ENTREGA EXTERNA' } });
  user = await db.user.create({ data: { email: `${prefix}@example.invalid`, name: 'Contador de teste', passwordHash: 'sem-login', role: 'contador', accountType: 'FIRM' } });
  await db.companyFirmAccess.create({ data: { companyId: company.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const criar = () => db.guide.create({ data: { portalClientId: company.id, source: 'UPLOAD', tipo: 'SIMPLES', status: 'PROCESSED', hash: randomUUID(), pdfBytes: Buffer.from('%PDF-1.4\nTeste'), competencia: '2026-10', valor: 10, paymentStatus: 'OPEN' } });
  const g = await criar(), s = criarEntregaExternaGuia({ db });
  const body = { dataEntrega: '2026-10-20', meio: 'WHATSAPP_PARTICULAR', idempotencyKey: 'teste-concorrente', confirmado: true, revisaoDocumento: revisaoEntrega(g) };
  await s.previa(company.id, g.id, user);
  await assert.rejects(s.previa(company.id, g.id, { ...user, id: 'sem-vinculo' }), e => e.code === 'forbidden');
  assert.equal(await db.envioGuia.count({ where: { guideId: g.id } }), 0);
  await Promise.all([s.registrar(company.id, g.id, user, body), s.registrar(company.id, g.id, user, body)]);
  assert.equal(await db.envioGuiaTentativa.count({ where: { envioGuia: { guideId: g.id } } }), 1);
  assert.equal(await db.appSetting.count({ where: { key: { startsWith: `guia:entrega-externa:${g.id}:` } } }), 1);
  assert(foiEnviadaComLegado((await enviosPorGuia([g.id])).get(g.id), g));
  const atual = await db.guide.findUnique({ where: { id: g.id } });
  assert.equal(atual.paymentStatus, 'OPEN'); assert.equal(atual.emailStatus, null); assert.equal(atual.liberadaCliente, false);
  await assert.rejects(reservarSemEntregaExterna(db, [atual], () => { throw Error('não deve reservar'); }), e => e.code === 'GUIA_ENTREGA_EXTERNA');
  // A declaração não cria recibo Meta apto para acompanhamento.
  await assert.rejects(conferirEntregaGuiaWhatsapp(db, atual, 'nao-roteavel'), e => e.code === 'GUIA_WHATSAPP_NAO_ENTREGUE');
  for (const patch of [{ pdfBytes: null }, { extracted: { conferenciaDocumentoPendente: true } }, { status: 'ERROR' }]) {
    await db.guide.update({where:{id:g.id},data:patch});
    assert.equal((await enviosPorGuia([g.id])).has(g.id),false);
    await assert.rejects(s.registrar(company.id,g.id,user,{...body,idempotencyKey:'nao-registrar'}),e=>e.code==='guia_indisponivel');
    await db.guide.update({where:{id:g.id},data:{status:'PROCESSED',pdfBytes:Buffer.from('%PDF-1.4\nTeste'),extracted:{}}});
  }
  await db.guide.update({ where: { id: g.id }, data: { hash: 'nova-revisao' } });
  const nova = await db.guide.findUnique({ where: { id: g.id } });
  assert.equal(foiEnviadaComLegado((await enviosPorGuia([g.id])).get(g.id), nova), false);
  await assert.rejects(s.registrar(company.id, g.id, user, body), e => e.code === 'guia_alterada');

  const falhaGuia = await criar();
  const txFalha = fn => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
    if (key === 'appSetting') return new Proxy(target.appSetting, { get(model, metodo) { return metodo === 'create' ? async () => { throw Error('auditoria_falhou'); } : model[metodo]; } });
    return target[key];
  } })));
  const falhaDb = new Proxy(db, { get(target, key) { return key === '$transaction' ? txFalha : target[key]; } });
  await assert.rejects(criarEntregaExternaGuia({ db: falhaDb }).registrar(company.id, falhaGuia.id, user, { ...body, revisaoDocumento: revisaoEntrega(falhaGuia) }), /auditoria_falhou/);
  assert.equal(await db.envioGuia.count({ where: { guideId: falhaGuia.id } }), 0);

  const disputa = await criar();
  const outcomes = await Promise.allSettled([
    s.registrar(company.id, disputa.id, user, { ...body, revisaoDocumento: revisaoEntrega(disputa) }),
    reservarSemEntregaExterna(db, [disputa], tx => tx.guide.update({ where: { id: disputa.id }, data: { emailStatus: 'SENDING' } })),
  ]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const entrega = await db.envioGuia.count({ where: { guideId: disputa.id, canal: 'EXTERNO' } });
  const disputada = await db.guide.findUnique({ where: { id: disputa.id } });
  assert(!(entrega && disputada.emailStatus === 'SENDING'));
  assert.equal(rede, 0);
  console.log('PASS: ACL, leitura sem efeito, idempotência concorrente, revisão invalidada, sem recibo/pagamento, rollback auditoria, disputa com envio automático e zero rede.');
} finally {
  if (company) {
    const guias = await db.guide.findMany({ where: { portalClientId: company.id }, select: { id: true } });
    await db.appSetting.deleteMany({ where: { OR: guias.map(g => ({ key: { startsWith: `guia:entrega-externa:${g.id}:` } })) } });
    await db.guide.deleteMany({ where: { portalClientId: company.id } });
    await db.portalClient.delete({ where: { id: company.id } });
  }
  if (user) await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
