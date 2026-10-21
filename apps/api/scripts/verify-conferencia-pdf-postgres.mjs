import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const url = new URL(process.argv[2] || 'about:blank');
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55489');
assert.equal(url.username, 'comercial_test'); assert.equal(url.pathname, '/comercial_20261021_governance_test');
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
let rede = 0;
const semRede = () => { rede++; throw Error('Rede externa proibida'); };
http.request = http.get = https.request = https.get = globalThis.fetch = semRede;
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { criarApresentacaoDiagnostico } = await import('../src/application/onboarding/ApresentacaoDiagnosticoService.js');
const id = randomUUID(), user = { id: `contador-${id}`, role: 'contador', accountType: 'FIRM' };
const jornada = async (ficha, tx) => ({ diagnostico: await tx.onboardingEvento.findFirst({ where: { onboardingId: ficha.id, tipo: 'JORNADA_DIAGNOSTICO' }, orderBy: { createdAt: 'desc' } }), diagnosticoPendencias: [], analises: [] });
const servico = banco => criarApresentacaoDiagnostico({ db: banco, jornada, gerarPdf: async () => Buffer.from('%PDF-fixture') });
try {
  await db.onboarding.create({ data: { id, origem: 'TRANSFERENCIA', cnpj: '11222333000181', versao: 3, dados: { razaoSocial: 'Fixture PDF isolada' } } });
  const diag = await db.onboardingEvento.create({ data: { onboardingId: id, tipo: 'JORNADA_DIAGNOSTICO', atorId: user.id, dados: { servicos: 'Escopo sintético', dispensaConsultaPrivada: 'Não consultado; teste isolado.' } } });
  const s = servico(db), meta = await s.carregar(id, user);
  await s.documento(id, diag.id, user, meta.conteudoHash);
  const filtro = { onboardingId: id, tipo: 'JORNADA_DEVOLUTIVA_CONFERIDA' };
  assert.equal(await db.onboardingEvento.count({ where: filtro }), 0);
  const body = { versao: 3, conteudoHash: meta.conteudoHash, confirmado: true };
  const resultados = await Promise.all([s.conferir(id, diag.id, user, body), s.conferir(id, diag.id, user, body)]);
  assert.equal(await db.onboardingEvento.count({ where: filtro }), 1);
  assert.equal(resultados.filter(r => r.jaConferida).length, 1);
  const salvo = resultados[0].conferencia;
  assert.equal(salvo.atorId, user.id); assert(salvo.createdAt); assert.equal(salvo.dados.enviadoAoCliente, false);
  await db.onboardingEvento.deleteMany({ where: filtro });
  const antes = await db.onboarding.findUnique({ where: { id } });
  const transacaoComFalha = fn => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
    if (key === 'onboardingEvento') return new Proxy(target.onboardingEvento, { get(model, metodo) { return metodo === 'create' ? async () => { throw Error('auditoria_indisponivel'); } : model[metodo]; } });
    return target[key];
  } })));
  const falha = new Proxy(db, { get(target, key) { return key === '$transaction' ? transacaoComFalha : target[key]; } });
  await assert.rejects(servico(falha).conferir(id, diag.id, user, body), /auditoria_indisponivel/);
  assert.equal(await db.onboardingEvento.count({ where: filtro }), 0);
  assert.equal((await db.onboarding.findUnique({ where: { id } })).updatedAt.getTime(), antes.updatedAt.getTime());
  await db.onboardingEvento.update({ where: { id: diag.id }, data: { dados: { ...diag.dados, servicos: 'Escopo alterado' } } });
  await assert.rejects(s.conferir(id, diag.id, user, body), e => e.code === 'apresentacao_alterada');
  assert.equal(await db.onboardingEvento.count({ where: filtro }), 0);
  assert.equal(rede, 0);
  console.log('PASS: leitura sem efeito, concorrência/idempotência, autoria, rollback da auditoria e hash antigo recusado; zero rede externa.');
} finally {
  await db.onboardingEvento.deleteMany({ where: { onboardingId: id } });
  await db.onboarding.deleteMany({ where: { id } });
  await db.$disconnect();
}
