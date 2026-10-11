import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { salvarCadastroReforma, conferirNfse, lerConferencia, carteiraReforma } from '../src/application/fiscal/reforma/ReformaFiscalService.js';
const [url, clientPath] = process.argv.slice(2);
const parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.username !== 'reforma_test' || parsed.pathname !== '/reforma_check') throw Error('Somente o banco descartável reforma_check é permitido.');
const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(clientPath, 'index.js'));
const db = new PrismaClient({ datasources: { db: { url } } });
const checks = [];
try {
  assert.equal(await db.portalClient.count(), 0, 'O banco precisa estar vazio.');
  const a = await db.portalClient.create({ data: { razao: 'Teste A', cnpj: '11111111000111' } });
  const b = await db.portalClient.create({ data: { razao: 'Teste B', cnpj: '22222222000122' } });
  const usuario = { id: 'contador-teste', name: 'Contador fictício', role: 'contador' };
  const dados = { periodos: [{ inicio: '2027-01-01', fim: '2027-06-30', regime: 'SIMPLES', forma: 'REGULAR', situacao: 'SOLICITADA', evidencia: 'Comprovante fictício' }], emissor: 'NAO_VERIFICADO', motivo: 'Primeira revisão' };
  const entrada = { id: randomUUID(), versao: 0, dados };
  const resultados = await Promise.allSettled([
    salvarCadastroReforma(db, a.id, entrada, usuario),
    salvarCadastroReforma(db, a.id, { ...entrada, id: randomUUID() }, usuario),
  ]);
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  const primeira = resultados.find(r => r.status === 'fulfilled').value;
  assert.equal((await salvarCadastroReforma(db, a.id, { ...entrada, id: primeira.id }, usuario)).id, primeira.id);
  checks.push('Concorrência real e idempotência após leitura JSONB');
  await salvarCadastroReforma(db, a.id, { id: randomUUID(), versao: 1, dados: { ...dados, motivo: 'Opção confirmada', periodos: [{ ...dados.periodos[0], situacao: 'CONFIRMADA' }] } }, usuario);
  assert.equal(await db.reformaFiscalRevisao.count({ where: { portalClientId: a.id } }), 2);
  assert.equal((await db.reformaFiscalRevisao.findUnique({ where: { id: primeira.id } })).dados.periodos[0].situacao, 'SOLICITADA');
  assert.equal(await db.reformaFiscalRevisao.count({ where: { portalClientId: b.id } }), 0);
  checks.push('Histórico anterior imutável e empresas separadas');
  const nota = await db.portalInvoice.create({ data: { clientId: a.id, type: 'NFSE', competencia: new Date('2026-10-01'), papel: 'EMIT', statusEfetivo: 'autorizada', numero: '1' } });
  await db.portalInvoice.create({ data: { clientId: a.id, type: 'NFSE', competencia: null, papel: 'DEST', statusEfetivo: 'autorizada', numero: '2' } });
  await db.portalInvoice.create({ data: { clientId: a.id, type: 'NFE', competencia: new Date('2026-10-01'), papel: 'DEST', statusEfetivo: 'autorizada' } });
  await db.portalInvoice.create({ data: { clientId: b.id, type: 'NFSE', competencia: new Date('2026-10-01'), papel: 'EMIT', statusEfetivo: 'autorizada' } });
  const v = await conferirNfse(db, a.id, '2026-10', usuario);
  assert.equal(v.resumo.total, 2); assert.equal(v.resumo.revisao, 2);
  assert.ok(v.itens.every(i => i.achados.some(x => x.codigo === 'XML_AUSENTE')));
  assert.equal((await lerConferencia(db, a.id, '2026-10')).desatualizada, false);
  await db.portalInvoice.update({ where: { id: nota.id }, data: { xmlRaw: '<NFSe/>' } });
  assert.equal((await lerConferencia(db, a.id, '2026-10')).desatualizada, true);
  assert.equal((await lerConferencia(db, b.id, '2026-10')).verificacao, null);
  checks.push('Conferência persistida, ausência de XML explícita, sem competência incluída, NF-e e outra empresa excluídas, resultado obsoleto detectado');
  assert.deepEqual((await carteiraReforma(db, usuario, '2027-01')).empresas, []);
  assert.equal((await carteiraReforma(db, { ...usuario, role: 'admin' }, '2027-01')).empresas.length, 2);
  checks.push('Carteira sem vínculo não expõe empresas; admin segue RBAC existente');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await db.$disconnect(); }
