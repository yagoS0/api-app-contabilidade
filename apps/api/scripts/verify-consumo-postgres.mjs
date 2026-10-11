import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cnpjTemDvValido } from '@contabilidade/shared/documentos-fiscais';
import { lerBaseConsumo, vincularEstabelecimentos, salvarConfiguracaoConsumo, prepararRevisaoConsumo } from '../src/application/fiscal/consumo/ApuracaoConsumoService.js';
const [url, clientPath] = process.argv.slice(2);
const parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.username !== 'consumo_test' || parsed.pathname !== '/consumo_check') throw Error('Somente banco descartável consumo_check.');
const { PrismaClient } = createRequire(import.meta.url)(path.join(clientPath, 'index.js'));
const db = new PrismaClient({ datasources: { db: { url } } });
const checks = [];
function documentoTeste(base12) {
  const doc = Array.from({ length: 100 }, (_, n) => base12 + String(n).padStart(2, '0')).find(cnpjTemDvValido);
  assert.ok(doc, 'Fixture precisa de DV válido');
  return doc;
}
try {
  assert.equal(await db.portalClient.count(), 0);
  const a = await db.portalClient.create({ data: { razao: 'Empresa fictícia A', cnpj: documentoTeste('AB1234560001') } });
  const b = await db.portalClient.create({ data: { razao: 'Empresa fictícia B', cnpj: documentoTeste('ZZ1234560001') } });
  const c = await db.apuracaoConsumoContribuinte.create({ data: { cnpjBase: 'AB123456', criadoPorId: 'teste' } });
  const e = await db.apuracaoConsumoEstabelecimento.create({ data: { contribuinteId: c.id, portalClientId: a.id, criadoPorId: 'teste' } });
  await assert.rejects(db.apuracaoConsumoEstabelecimento.create({ data: { contribuinteId: c.id, portalClientId: b.id, criadoPorId: 'teste' } }));
  await assert.rejects(db.portalClient.update({ where: { id: a.id }, data: { cnpj: documentoTeste('ZZ1234560002') } }));
  checks.push('CNPJ alfanumérico aceito; vínculo e alteração para outra base recusados');
  const config = { contribuinteId: c.id, tributo: 'CBS', ambiente: 'HOMOLOGACAO', versao: 1, dados: {}, requestKey: randomUUID(), requestHash: 'a'.repeat(64), criadoPorId: 'teste' };
  const races = await Promise.allSettled([1, 2].map(() => db.apuracaoConsumoConfiguracao.create({ data: config })));
  assert.equal(races.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(races.filter(x => x.status === 'rejected' && x.reason.code === 'P2002').length, 1);
  const cfg = races.find(x => x.status === 'fulfilled').value;
  assert.equal(cfg.habilitado, false);
  checks.push('Concorrência real: uma configuração/intenção; habilitação local desligada');
  const rev = { contribuinteId: c.id, tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2026-10', versao: 1, configuracaoId: cfg.id, cadastroSnapshot: { estabelecimentos: [a.id] }, dados: {}, requestKey: randomUUID(), requestHash: 'b'.repeat(64), criadoPorId: 'teste' };
  const rr = await Promise.allSettled([1, 2].map(() => db.apuracaoConsumoRevisao.create({ data: rev })));
  assert.equal(rr.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(rr.filter(x => x.status === 'rejected' && x.reason.code === 'P2002').length, 1);
  const r = rr.find(x => x.status === 'fulfilled').value;
  assert.equal(r.estado, 'PREPARACAO');
  await assert.rejects(db.apuracaoConsumoRevisao.create({ data: { ...rev, requestKey: randomUUID(), tributo: 'IBS' } }));
  await assert.rejects(db.apuracaoConsumoRevisao.create({ data: { ...rev, requestKey: randomUUID(), competencia: '2026-13' } }));
  checks.push('Revisão concorrente única; PREPARACAO; config de outro tributo e mês inválido recusados');
  for (const [delegate, id, data] of [
    ['apuracaoConsumoContribuinte', c.id, { cnpjBase: 'AB999999' }],
    ['apuracaoConsumoEstabelecimento', e.id, { criadoPorId: 'outro' }],
    ['apuracaoConsumoConfiguracao', cfg.id, { habilitado: true }],
    ['apuracaoConsumoRevisao', r.id, { dados: { alterado: true } }],
  ]) {
    await assert.rejects(db[delegate].update({ where: { id }, data }));
    await assert.rejects(db[delegate].delete({ where: { id } }));
  }
  checks.push('Quatro modelos protegidos contra UPDATE/DELETE no PostgreSQL');
  const admin = { id: 'admin-teste', role: 'admin' };
  const ctx = { tributo: 'IBS', ambiente: 'PRODUCAO', competencia: '2026-11' };
  assert.equal((await lerBaseConsumo(db, b.id, ctx, admin)).contribuinte, null);
  const antes = await db.apuracaoConsumoContribuinte.count();
  await lerBaseConsumo(db, b.id, ctx, admin);
  assert.equal(await db.apuracaoConsumoContribuinte.count(), antes);
  await vincularEstabelecimentos(db, b.id, { portalClientIds: [b.id] }, admin);
  const entrada = { id: randomUUID(), versao: 0, tributo: ctx.tributo, ambiente: ctx.ambiente, habilitado: false, dados: { motivo: 'Teste isolado' } };
  const conc = await Promise.allSettled([entrada, { ...entrada, id: randomUUID() }].map(x => salvarConfiguracaoConsumo(db, b.id, x, admin)));
  assert.equal(conc.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(conc.filter(x => x.status === 'rejected' && x.reason.status === 409).length, 1);
  const saved = conc.find(x => x.status === 'fulfilled').value;
  const replay = { ...entrada, id: saved.requestKey };
  assert.equal((await salvarConfiguracaoConsumo(db, b.id, replay, admin)).id, saved.id);
  await assert.rejects(salvarConfiguracaoConsumo(db, b.id, { ...replay, habilitado: true }, admin), { status: 409 });
  const ri = { id: randomUUID(), versao: 0, ...ctx, motivo: 'Preparação local' };
  const sr = await prepararRevisaoConsumo(db, b.id, ri, admin);
  assert.equal((await prepararRevisaoConsumo(db, b.id, ri, admin)).id, sr.id);
  assert.equal(sr.dados.valoresOficiais, null);
  assert.ok(sr.dados.pendencias.includes('COLETA_OFICIAL_NAO_IMPLEMENTADA'));
  assert.equal((await lerBaseConsumo(db, b.id, ctx, admin)).desatualizada, false);
  await salvarConfiguracaoConsumo(db, b.id, { ...entrada, id: randomUUID(), versao: 1, habilitado: true }, admin);
  assert.equal((await lerBaseConsumo(db, b.id, ctx, admin)).desatualizada, true);
  checks.push('Services reais: GET sem escrita, concorrência 409, replay idempotente, intenção alterada rejeitada, configuração nova invalida revisão');
  const contador = await db.user.create({ data: { email: 'consumo-test@example.invalid', passwordHash: 'not-a-password', role: 'user', accountType: 'FIRM' } });
  await db.companyFirmAccess.create({ data: { companyId: a.id, userId: contador.id, role: 'ACCOUNTANT' } });
  const filial = await db.portalClient.create({ data: { razao: 'Filial fictícia', cnpj: documentoTeste('AB1234560002') } });
  await vincularEstabelecimentos(db, a.id, { portalClientIds: [filial.id] }, admin);
  await assert.rejects(lerBaseConsumo(db, a.id, ctx, contador), { status: 403 });
  await assert.rejects(vincularEstabelecimentos(db, a.id, { portalClientIds: [filial.id] }, contador), { status: 403 });
  checks.push('Acesso a uma empresa não autoriza leitura/escrita do grupo com filial sem acesso');
  await db.companyFirmAccess.create({ data: { companyId: filial.id, userId: contador.id, role: 'ACCOUNTANT' } });
  await lerBaseConsumo(db, a.id, ctx, contador);
  await db.companyFirmAccess.update({ where: { companyId_userId: { companyId: a.id, userId: contador.id } }, data: { role: 'STAFF' } });
  await assert.rejects(lerBaseConsumo(db, a.id, ctx, contador), { status: 403 });
  checks.push('STAFF não lê fundação que inclui referências ao cofre');
  const cred = await db.companyCredential.create({ data: { portalClientId: b.id, rotulo: 'Referência fictícia sem senha' } });
  await salvarConfiguracaoConsumo(db, b.id, { ...entrada, id: randomUUID(), versao: 2, habilitado: true,
    dados: { motivo: 'Referência cofre', credencialId: cred.id, credencialPortalClientId: b.id } }, admin);
  const antesRemocao = await prepararRevisaoConsumo(db, b.id, { ...ri, id: randomUUID(), versao: 1 }, admin);
  assert.equal(antesRemocao.dados.credencialDisponivel, true);
  assert.equal((await lerBaseConsumo(db, b.id, ctx, admin)).desatualizada, false);
  await db.companyCredential.delete({ where: { id: cred.id } });
  const depoisRemocao = await lerBaseConsumo(db, b.id, ctx, admin);
  assert.equal(depoisRemocao.credencialDisponivel, false);
  assert.equal(depoisRemocao.desatualizada, true);
  const semCred = await prepararRevisaoConsumo(db, b.id, { ...ri, id: randomUUID(), versao: 2 }, admin);
  assert.ok(semCred.dados.pendencias.includes('CREDENCIAL_REFERENCIADA_INDISPONIVEL'));
  checks.push('Exclusão real de credencial invalida revisão anterior e aparece como pendência na próxima');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await db.$disconnect(); }
