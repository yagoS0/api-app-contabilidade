// Integration checks use a disposable PostgreSQL and synthetic transports only.
import assert from 'node:assert/strict';
import { randomUUID, createECDH, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const url = new URL(process.argv[2] || process.env.DATABASE_URL);
const local = url.hostname === '127.0.0.1' && url.port === '55447' && url.pathname === '/atendimento_pwa_check' && url.username === 'consulta_test';
const ci = url.hostname === '127.0.0.1' && url.port === '55439' && url.pathname === '/whatsapp_delivery_check' && url.username === 'whatsapp_check' && url.password === 'ci_test_only';
if (url.protocol !== 'postgresql:' || !(local || ci)) throw Error('Use apenas os bancos locais/CI descartáveis explicitamente permitidos.');
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: 'test', LOG_LEVEL: 'fatal', WHATSAPP_ATENDIMENTO_PUSH: '0', INTEGRACAO_WHATSAPP: '0', INTEGRACAO_IA_COMERCIAL: '0' });
let rede = 0;
const semRede = () => { rede++; throw Error('Rede externa proibida nesta simulação.'); };
globalThis.fetch = http.request = http.get = https.request = https.get = semRede;
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { comIntencaoEnvio, consultarIntencaoEnvio } = await import('../src/application/whatsapp/IntencaoEnvioAtendimentoService.js');
const { salvarRascunhoAtendimento, excluirRascunhoAtendimento, lerRascunhoAtendimento, expirarRascunhosAtendimento } = await import('../src/application/whatsapp/RascunhoAtendimentoService.js');
const { registrarInscricaoPush, revogarInscricaoPush, registrarEventoPush, processarPushAtendimento, podeNotificarInscricao, limparHistoricoPush } = await import('../src/application/whatsapp/AtendimentoPushService.js');
const prefixo = `pwa-test-${randomUUID()}`, ids = [], config = { enabled: true };
let checks = 0, transportes = 0, notificacoes = 0;
const ok = texto => { checks++; console.log(`OK ${checks}: ${texto}`); };
let user;
try {
  user = await db.user.create({ data: { email: `${prefixo}@example.invalid`, passwordHash: 'not-a-login-hash', role: 'contador', accountType: 'FIRM', status: 'active' } });
  const conversa = await db.conversaWhatsapp.create({ data: { telefoneE164: '5511000000000', chaveEscopo: `sem-empresa:${prefixo}`, escopoVerificado: true } }); ids.push(conversa.id);
  const request = { userId: user.id, conversa, clientRequestId: randomUUID(), payload: { texto: 'Mensagem sintética' }, client: db };
  const enviar = async intencaoEnvioId => {
    transportes++;
    const mensagem = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, intencaoEnvioId, direcao: 'out', autor: 'HUMANO', tipo: 'text', corpo: 'Mensagem sintética', statusEnvio: 'enviado', providerMessageId: `${prefixo}-${transportes}` } });
    return { mensagem, wamid: mensagem.providerMessageId };
  };
  const juntos = await Promise.allSettled([comIntencaoEnvio({ ...request, enviar }), comIntencaoEnvio({ ...request, enviar })]);
  assert.equal(transportes, 1); assert(juntos.some(x => x.status === 'fulfilled'));
  assert.equal((await comIntencaoEnvio({ ...request, enviar })).repetida, true);
  await assert.rejects(comIntencaoEnvio({ ...request, payload: { texto: 'Outro texto' }, enviar }), e => e.code === 'INTENCAO_DIVERGENTE');
  await assert.rejects(comIntencaoEnvio({ ...request, conversa: { ...conversa, telefoneE164: '5511000000001' }, enviar }), e => e.code === 'INTENCAO_DIVERGENTE');
  ok('Duas requisições simultâneas reservam um único transporte; repetição e alteração de destino são protegidas.');

  const incerta = { ...request, clientRequestId: randomUUID(), enviar: async () => { transportes++; throw Object.assign(Error('Timeout sintético'), { indeterminado: true }); } };
  await assert.rejects(comIntencaoEnvio(incerta));
  await assert.rejects(comIntencaoEnvio(incerta), e => e.code === 'ENVIO_INDETERMINADO');
  assert.equal(transportes, 2);
  assert.equal((await consultarIntencaoEnvio(incerta)).status, 'INCERTA');
  ok('Timeout mantém resultado incerto e não repete automaticamente o envio.');

  const prova = { ...request, clientRequestId: randomUUID(), enviar };
  const clientFalha = new Proxy(db, { get(target, prop) { if (prop === 'intencaoEnvioAtendimento') return new Proxy(target[prop], { get(model, p) { return p === 'update' ? async () => { throw Error('Falha sintética após aceite'); } : model[p]; } }); return target[prop]; } });
  await assert.rejects(comIntencaoEnvio({ ...prova, client: clientFalha }));
  assert.equal((await consultarIntencaoEnvio(prova)).status, 'ACEITA');
  await comIntencaoEnvio(prova); assert.equal(transportes, 3);
  ok('Mensagem vinculada recupera aceite mesmo após falha na persistência do resultado da intenção.');

  const draft = { userId: user.id, conversa, client: db };
  const primeiro = await salvarRascunhoAtendimento({ ...draft, versao: 0, conteudo: { texto: 'Primeira edição' } });
  const edicoes = await Promise.allSettled(['A', 'B'].map(texto => salvarRascunhoAtendimento({ ...draft, versao: primeiro.versao, conteudo: { texto } })));
  assert.equal(edicoes.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(excluirRascunhoAtendimento({ ...draft, versao: 1 }), e => e.code === 'RASCUNHO_CONFLITO');
  const apagado = await excluirRascunhoAtendimento({ ...draft, versao: 2 });
  const refeito = await salvarRascunhoAtendimento({ ...draft, versao: apagado.versao, conteudo: { texto: 'Novo após exclusão' } });
  assert.equal(refeito.versao, 4);
  await assert.rejects(salvarRascunhoAtendimento({ ...draft, versao: 1, conteudo: { texto: 'Aba antiga' } }), e => e.code === 'RASCUNHO_CONFLITO');
  await expirarRascunhosAtendimento({ client: db, agora: new Date(Date.now() + 8 * 86400000) });
  assert.equal((await lerRascunhoAtendimento(draft)).conteudo.texto, '');
  assert.equal((await lerRascunhoAtendimento(draft)).versao, 5);
  ok('Rascunhos concorrentes preservam versão, exclusão e expiração sem permitir sobrescrita por aba antiga.');

  const curva = createECDH('prime256v1'); curva.generateKeys();
  const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/${prefixo}`, keys: { p256dh: curva.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const inscrita = await registrarInscricaoPush({ userId: user.id, subscription, deviceName: 'Aparelho sintético' }, { client: db, config });
  const inscricao = await db.inscricaoPushAtendimento.findUnique({ where: { id: inscrita.id } });
  let rollbackId;
  await assert.rejects(db.$transaction(async tx => {
    const m = await tx.mensagemWhatsapp.create({ data: { conversaId: conversa.id, providerMessageId: `${prefixo}-rollback`, direcao: 'in', tipo: 'text', corpo: 'Rollback sintético' } }); rollbackId = m.id;
    await registrarEventoPush({ mensagem: m, conversa, client: tx, config });
    throw Error('Rollback sintético');
  }), /Rollback sintético/);
  assert.equal(await db.eventoPushAtendimento.findUnique({ where: { id: rollbackId } }), null);
  const mensagem = await db.$transaction(async tx => {
    const m = await tx.mensagemWhatsapp.create({ data: { conversaId: conversa.id, providerMessageId: `${prefixo}-inbound`, direcao: 'in', tipo: 'text', corpo: 'Conteúdo privado sintético' } });
    await registrarEventoPush({ mensagem: m, conversa, client: tx, config }); return m;
  });
  const evento = await db.eventoPushAtendimento.findUnique({ where: { id: mensagem.id } });
  assert.equal(await podeNotificarInscricao({ inscricao, evento }, { client: db }), true);
  const transportar = async (_subscription, payload) => { notificacoes++; assert(!JSON.stringify(payload).includes('privado')); assert.equal(payload.vinculo, inscrita.vinculo); };
  await processarPushAtendimento({ client: db, config, transportar, agora: new Date(Date.now() - 1000) });
  await Promise.all([processarPushAtendimento({ client: db, config, transportar }), processarPushAtendimento({ client: db, config, transportar })]);
  assert.equal(notificacoes, 1);
  assert.equal(await db.entregaPushAtendimento.count({ where: { eventoId: evento.id, status: 'ACEITA' } }), 1);
  ok('Evento é atômico com a mensagem e dois workers produzem uma única notificação genérica.');

  await db.conversaWhatsapp.update({ where: { id: conversa.id }, data: { lidaAteEm: new Date() } });
  assert.equal(await podeNotificarInscricao({ inscricao, evento }, { client: db }), false);
  await revogarInscricaoPush({ userId: user.id, endpoint: subscription.endpoint }, { client: db });
  const revogada = await db.inscricaoPushAtendimento.findUnique({ where: { id: inscrita.id } });
  assert.equal(revogada.ativa, false); assert.notEqual(revogada.vinculo, inscrita.vinculo);
  assert.equal(await podeNotificarInscricao({ inscricao: revogada, evento }, { client: db }), false);
  assert.equal(rede, 0);
  ok('Leitura e revogação bloqueiam notificações; nenhum provedor externo foi acessado.');
  await db.conversaWhatsapp.update({ where: { id: conversa.id }, data: { lidaAteEm: null } });
  const backlog = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, providerMessageId: `${prefixo}-backlog`, direcao: 'in', tipo: 'text', corpo: 'Entrada durante intervalo desativado' } });
  await registrarEventoPush({ mensagem: backlog, conversa, client: db, config, agora: new Date(inscricao.createdAt.getTime() + 1) });
  const reativada = await registrarInscricaoPush({ userId: user.id, subscription }, { client: db, config });
  assert.notEqual(reativada.vinculo, inscrita.vinculo);
  await processarPushAtendimento({ client: db, config, transportar });
  assert.equal(await db.entregaPushAtendimento.count({ where: { eventoId: backlog.id } }), 0);
  assert.equal(notificacoes, 1);
  ok('Reativar notificações não importa entradas anteriores à ativação atual.');
  const antigo = new Date(Date.now() - 31 * 86400000);
  await db.eventoPushAtendimento.update({ where: { id: evento.id }, data: { processadoEm: antigo } });
  await db.entregaPushAtendimento.updateMany({ where: { eventoId: evento.id }, data: { updatedAt: antigo } });
  const protegido = await db.eventoPushAtendimento.create({ data: { id: `${prefixo}-pendente`, conversaId: conversa.id, createdAt: antigo, expiraEm: antigo, processadoEm: antigo } });
  await db.entregaPushAtendimento.create({ data: { eventoId: protegido.id, inscricaoId: inscrita.id, vinculo: inscrita.vinculo, updatedAt: antigo } });
  await limparHistoricoPush({ client: db });
  assert.equal(await db.eventoPushAtendimento.findUnique({ where: { id: evento.id } }), null);
  assert(await db.eventoPushAtendimento.findUnique({ where: { id: protegido.id } }));
  ok('Retenção elimina histórico encerrado após 30 dias e preserva entregas ainda pendentes.');
  console.log(JSON.stringify({ checks, transportesSinteticos: transportes, notificacoesSinteticas: notificacoes, acessosExternos: rede }));
} finally {
  const eventos = await db.eventoPushAtendimento.findMany({ where: { conversaId: { in: ids } }, select: { id: true } });
  await db.entregaPushAtendimento.deleteMany({ where: { eventoId: { in: eventos.map(e => e.id) } } });
  await db.eventoPushAtendimento.deleteMany({ where: { conversaId: { in: ids } } });
  if (user) {
    await db.inscricaoPushAtendimento.deleteMany({ where: { userId: user.id } });
    await db.rascunhoAtendimento.deleteMany({ where: { userId: user.id } });
    await db.intencaoEnvioAtendimento.deleteMany({ where: { userId: user.id } });
  }
  await db.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: ids } } });
  await db.conversaWhatsapp.deleteMany({ where: { id: { in: ids } } });
  if (user) await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
