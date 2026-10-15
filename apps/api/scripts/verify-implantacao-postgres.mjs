import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
const url = new URL(process.argv[2]);
if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.username !== 'implantacao_test' || url.pathname !== '/implantacao_check') throw Error('Somente banco local descartável de implantação.');
process.env.DATABASE_URL = url.href;
const semRede = () => { throw Error('Provedores externos não são permitidos neste teste.'); };
globalThis.fetch = http.get = http.request = https.get = https.request = semRede;
const { PrismaClient } = await import(pathToFileURL(process.argv[3]).href);
const db = new PrismaClient();
const { lerImplantacao, salvarImplantacao } = await import('../src/application/company/ImplantacaoService.js');
const corpo = { versao: 0, status: 'AGENDADO', responsavel: 'Equipe de teste', prazo: '2026-10-20', pendencia: 'Solicitar renovação' };
try {
  const empresa = await db.portalClient.create({ data: { razao: 'Empresa sintética', cnpj: '12345678000195' } });
  const outra = await db.portalClient.create({ data: { razao: 'Outra empresa sintética', cnpj: '98765432000198' } });
  const o = await db.onboarding.create({ data: { origem: 'TRANSFERENCIA', status: 'CONVERTIDO', portalClientId: empresa.id, convertidoEm: new Date(), etapas: { create: [
    { chave: 'certificado_a1', titulo: 'Certificado conferido', ordem: 1, acao: 'CERTIFICADO_A1', concluidaEm: new Date('2026-10-10T12:00:00Z'), concluidaPorId: 'u-original', observacao: 'Histórico preservado' },
    { chave: 'documentos', titulo: 'Receber documentos', ordem: 2, observacao: 'Falta contrato social' },
  ] } }, include: { etapas: true } });
  const antes = JSON.stringify(o);
  const inicial = await lerImplantacao(empresa.id, db);
  assert.equal(inicial.tarefas.find(t => t.chave === 'certificado_a1').status, 'CONCLUIDO');
  assert.equal(inicial.tarefas.find(t => t.chave === 'documentos').pendencia, 'Falta contrato social');
  assert.equal(await db.implantacaoTarefa.count(), 0);
  let r = await salvarImplantacao(empresa.id, 'certificado_a1', corpo, 'u-teste', db);
  assert.equal(r.tarefas.find(t => t.chave === 'certificado_a1').versao, 1);
  await assert.rejects(salvarImplantacao(empresa.id, 'certificado_a1', corpo, 'u-teste', db), e => e.status === 409);
  r = await salvarImplantacao(empresa.id, 'certificado_a1', { ...corpo, versao: 1, status: 'CONCLUIDO' }, 'u-final', db);
  const tarefa = r.tarefas.find(t => t.chave === 'certificado_a1');
  assert.equal(tarefa.concluidaPorId, 'u-final'); assert.equal(tarefa.historico.length, 2); assert.equal(tarefa.origem.observacao, 'Histórico preservado');
  assert.equal((await lerImplantacao(outra.id, db)).tarefas.find(t => t.chave === 'certificado_a1').status, 'A_FAZER');
  assert.equal(JSON.stringify(await db.onboarding.findUnique({ where: { id: o.id }, include: { etapas: true } })), antes);
  const concorrencia = await Promise.allSettled([salvarImplantacao(empresa.id, 'documentos', corpo, 'u1', db), salvarImplantacao(empresa.id, 'documentos', corpo, 'u2', db)]);
  assert.equal(concorrencia.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(concorrencia.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal(await db.implantacaoTarefa.count({ where: { portalClientId: empresa.id, chave: 'documentos' } }), 1);
  assert.equal((await db.portalClient.findUnique({ where: { id: empresa.id } })).emissaoClienteLiberada, false);
  console.log('OK: migrações, herança do onboarding convertido, leitura sem escrita, persistência, reabertura, auditoria, isolamento, conflito, concorrência e liberação fiscal preservada.');
} finally { await db.$disconnect(); }
