// Somente banco LOCAL e empresa sintética descartável. Nenhuma consulta fiscal externa.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL);
assert(url.hostname === '127.0.0.1' && url.port === '5433' && url.pathname === '/contabilidade_dev', 'Somente banco local');
const db = new PrismaClient(), id = randomUUID(), base = process.env.LOCAL_API_BASE || 'http://127.0.0.1:3000';
assert(new URL(base).hostname === '127.0.0.1', 'Somente API local');
const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL || 'admin@contabilidade.local', password: process.env.ADMIN_PASSWORD }) });
assert.equal(login.status, 200); const { accessToken } = await login.json();
const route = '/firm/companies/' + id;
async function call(path, body, status = 200, method) {
  const r = await fetch(base + route + path, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.equal(r.status, status, path + ': ' + JSON.stringify(data)); return data;
}
const lines = valor => [{ conta: '231', tipo: 'D', valor, ordem: 0, papel: 'PRINCIPAL' }, { conta: '111', tipo: 'C', valor, ordem: 1, papel: 'CAIXA' }];
async function entry(tipo, competencia, valor) {
  return db.accountingEntry.create({ data: { portalClientId: id, tipo, competencia, data: new Date(competencia + '-01T00:00:00Z'), historico: 'TESTE LOCAL ' + tipo, subtipo: tipo === 'PROVISAO' ? 'ISS' : null, statusPagamento: tipo === 'PROVISAO' ? 'ABERTO' : 'NA', lines: { create: lines(valor).map(({papel, ...l}) => l) } } });
}
try {
  await db.portalClient.create({ data: { id, razao: 'TESTE FLUXO CONTABIL TEMPORARIO', cnpj: '11999888000155' } });
  assert.equal((await fetch(base + route + '/pendencias-contabeis')).status, 401);
  const provisao = await entry('PROVISAO', '2025-12', 1000);
  const receita = await entry('RECEITA', '2026-01', 2000);
  for (const item of ['folhaProlabore','despesas','provisoes']) await call('/fechamento-contabil/2026-01/checklist/' + item, { ok: true }, 200, 'POST');
  assert.equal((await call('/pagamentos-pendentes?competencia=2026-01')).itens.length, 1);
  let estado = await call('/fechamento-contabil/2026-01');
  assert.equal(estado.checklistAutomatico.receitas, true); assert.equal(estado.checklist.pagamentos, false);
  await call('/entries/' + provisao.id + '/baixa', { data: '2026-01-20', historico: 'Pagamento parcial teste', lines: lines(400) }, 201);
  estado = await call('/fechamento-contabil/2026-01'); assert.equal(estado.checklistAutomatico.pagamentos, true);
  await call('/fechamento-contabil/2026-01/fechar', {});
  let circular = await call('/entries/circular?year=2025');
  assert(circular.fechamentos['2026-01'].fechadoEm);
  assert.equal(circular.provisoes.find(p => p.id === provisao.id).saldo, 600);
  assert.equal(circular.provisoes.find(p => p.id === provisao.id).pendenciaFechamento, true);
  let pendencias = await call('/pendencias-contabeis');
  assert.equal(pendencias.itens.length, 1); assert.equal(pendencias.itens[0].total, 60000); assert.equal(pendencias.itens[0].origem, 'CONTABILIDADE');
  await call('/entries/' + provisao.id + '/baixa', { data: '2026-01-25', historico: 'Recusa mes fechado', lines: lines(600) }, 409);
  await call('/fechamento-contabil/2026-01/reabrir', {}); assert.equal((await call('/pendencias-contabeis')).itens.length, 0);
  await call('/fechamento-contabil/2026-01/fechar', {});
  const final = await call('/entries/' + provisao.id + '/baixa', { data: '2026-02-20', historico: 'Quitacao teste', lines: lines(600) }, 201);
  assert.equal((await call('/pendencias-contabeis')).itens.length, 0);
  assert.equal((await call('/pagamentos-pendentes?competencia=2026-02')).itens.length, 0);
  const preview = await call('/entries/' + final.entry.id + '/estorno/preview');
  await call('/entries/' + final.entry.id + '/estorno', { motivo: 'Validacao local de estorno de pagamento', totalConferido: preview.totalEstornado });
  assert.equal((await call('/pendencias-contabeis')).itens[0].total, 60000);
  assert.equal((await call('/fechamento-contabil/2026-02')).checklistAutomatico.pagamentos, false);
  await call('/fechamento-contabil/2026-01/reabrir', {});
  await call('/entries/' + receita.id, null, 200, 'DELETE');
  assert.equal((await call('/fechamento-contabil/2026-01')).checklistAutomatico.receitas, false);
  const manual = await call('/pendencias-manuais', { id: randomUUID(), dados: { fonte: 'MUNICIPAL', tipo: 'DEBITO', estado: 'ABERTO', tributo: 'ISS', competencia: '01/2026', vencimento: '2026-02-20', dataReferencia: '2026-10-06', total: '100,00', observacoes: 'Teste local de persistência' } }, 201);
  assert.equal((await call('/pendencias-manuais')).itens[0].id, manual.item.id);
  console.log('APROVADO: login/escopo, receita automática, pagamento de mês anterior, parcial, virada de ano, fechamento, pendência fiscal contábil, bloqueio de mês fechado, reabertura, quitação, estorno, remoção do automático e persistência manual. Sem consultas externas.');
} finally {
  await db.portalClient.deleteMany({ where: { id } });
  await db.$disconnect();
}
