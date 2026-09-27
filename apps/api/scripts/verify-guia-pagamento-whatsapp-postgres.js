// PostgreSQL descartável; não carrega .env nem chama Meta, SERPRO ou e-mail.
// Execute após migrate deploy + prisma generate no ambiente isolado do CI.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { confirmarPagamentoWhatsapp, chaveFluxoPagamento } from '../src/application/guides/ConfirmarPagamentoWhatsappService.js';

const pos = process.argv.indexOf('--url');
const url = new URL(pos >= 0 ? process.argv[pos + 1] : 'invalid:');
if (!['postgresql:', 'postgres:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/^\/[a-zA-Z0-9_]+_check$/.test(url.pathname)) {
  throw Error('Use apenas PostgreSQL local descartável terminado em _check, com --url explícito.');
}
globalThis.fetch = async () => { throw Error('Rede externa proibida neste ensaio'); };
const client = new PrismaClient({ datasources: { db: { url: url.href } } });
const prefix = 'payment-check-' + randomUUID();
const agora = new Date('2026-09-25T12:00:00Z');
const expiraEm = new Date('2026-10-01T12:00:00Z');
const companyIds = [], guideIds = [], conversationIds = [], settingKeys = new Set();
let checks = 0;
const ok = message => console.log(`OK ${++checks}: ${message}`);

async function fixture() {
  const companyId = prefix + '-' + companyIds.length;
  await client.portalClient.create({ data: { id: companyId, cnpj: companyId, razao: 'Empresa sintética descartável' } });
  companyIds.push(companyId);
  const telefoneE164 = 'teste-' + randomUUID();
  const contato = await client.contatoWhatsapp.create({ data: { portalClientId: companyId, nome: 'Contato sintético', telefoneE164, ativo: true, optInEm: agora } });
  const conversa = await client.conversaWhatsapp.create({ data: { telefoneE164, portalClientId: companyId, chaveEscopo: prefix + ':' + randomUUID(), escopoVerificado: true } });
  conversationIds.push(conversa.id);
  const guia = await client.guide.create({ data: { portalClientId: companyId, tipo: 'FGTS', competencia: '2026-08', source: 'LOCAL', status: 'PROCESSED', liberadaCliente: true, paymentStatus: 'OPEN', valor: 125, hash: prefix + randomUUID() } });
  guideIds.push(guia.id);
  const token = 'altan.payment.confirm.' + randomUUID();
  settingKeys.add(token);
  settingKeys.add(chaveFluxoPagamento(conversa));
  await client.appSetting.create({ data: { key: token, value: { companyId, guideId: guia.id, contatoId: contato.id, telefone: telefoneE164, competencia: guia.competencia, hash: guia.hash, expiraEm: expiraEm.toISOString() } } });
  async function message(corpo, extra = {}) {
    return client.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'text', corpo, providerMessageId: prefix + randomUUID(), ...extra } });
  }
  async function run(mensagem, id = null, conferirAcesso = async () => {}) {
    settingKeys.add('pagamento_resposta:' + mensagem.id);
    return confirmarPagamentoWhatsapp({ id, conversa, mensagem, client, conferirAcesso, agora });
  }
  const read = () => client.guide.findUnique({ where: { id: guia.id } });
  const click = async () => run(await message('', { tipo: 'interactive' }), token);
  return { companyId, contato, conversa, guia, token, message, run, read, click };
}

try {
  const [server] = await client.$queryRaw`SELECT current_database() AS db`;
  assert.equal(server.db, url.pathname.slice(1));
  const f = await fixture();
  const clique = await f.message('', { tipo: 'interactive' });
  const clicks = await Promise.all([f.run(clique, f.token), f.run(clique, f.token)]);
  assert.deepEqual(clicks[0], clicks[1]);
  assert.match(clicks[0].texto, /Em que data/);
  assert.equal((await f.read()).paymentStatus, 'OPEN');
  assert.equal(await client.appSetting.count({ where: { key: 'pagamento_resposta:' + clique.id } }), 1);
  ok('cliques simultâneos geram uma única resposta persistida e não presumem data');

  for (const data of ['31/02/2026', '26/09/2026', 'ontem']) {
    await f.run(await f.message(data));
    assert.equal((await f.read()).paymentStatus, 'OPEN');
  }
  ok('datas inválidas, futuras e ambíguas não confirmam pagamento');

  const declaracao = await f.message('20/09/2026');
  const respostas = await Promise.all([f.run(declaracao), f.run(declaracao)]);
  assert.deepEqual(respostas[0], respostas[1]);
  assert.match(respostas[0].texto, /20\/09\/2026/);
  assert.deepEqual(await f.run(declaracao), respostas[0]);
  const pago = await f.read();
  assert.equal(pago.paymentStatus, 'PAID');
  assert.equal(pago.paymentStatusSource, 'CLIENTE');
  assert.equal(pago.paymentConfirmedAt.toISOString(), '2026-09-20T00:00:00.000Z');
  assert.equal(pago.clienteConfirmouEm.toISOString(), agora.toISOString());
  assert.equal(pago.baixada, false);
  ok('data declarada difere do clique; repetição concorrente não duplica nem gera baixa');

  const media = await f.message('', { tipo: 'document', midiaProvedorId: 'sintetico' });
  const arquivo = await client.arquivoWhatsapp.create({ data: { mensagemId: media.id, portalClientId: f.companyId, midiaProvedorId: 'sintetico', mimeType: 'application/pdf', expiraEm, conteudo: Buffer.from('comprovante sintético sem download') } });
  assert.match((await f.run(media)).texto, /Comprovante recebido/);
  const anexo = await client.arquivoWhatsapp.findUnique({ where: { id: arquivo.id } });
  assert.equal(anexo.comprovanteGuiaId, f.guia.id);
  assert.equal(anexo.dataPagamentoDeclarada.toISOString(), pago.paymentConfirmedAt.toISOString());
  assert.equal(anexo.analiseComprovante.confiavel, false);
  assert.equal((await f.read()).paymentStatusSource, 'CLIENTE');
  ok('comprovante vinculado à guia sem converter declaração em prova oficial');

  const oficial = await fixture();
  await oficial.click();
  await client.guide.update({ where: { id: oficial.guia.id }, data: { paymentStatus: 'PAID', paymentStatusSource: 'SERPRO', paymentConfirmedAt: new Date('2026-09-19T00:00:00Z') } });
  await oficial.run(await oficial.message('20/09/2026'));
  const preservado = await oficial.read();
  assert.equal(preservado.paymentStatusSource, 'SERPRO');
  assert.equal(preservado.paymentConfirmedAt.toISOString(), '2026-09-19T00:00:00.000Z');
  assert.equal(preservado.clienteConfirmouEm, null);
  ok('confirmação oficial recebida durante a conversa é preservada');

  const cancelado = await fixture();
  await cancelado.click();
  await cancelado.run(await cancelado.message('cancelar pagamento'));
  assert.equal((await cancelado.read()).paymentStatus, 'OPEN');
  await cancelado.click();
  await assert.rejects(cancelado.run(await cancelado.message('20/09/2026'), null, async () => { throw Error('acesso revogado'); }), /acesso revogado/);
  assert.equal((await cancelado.read()).paymentStatus, 'OPEN');
  ok('cancelamento e acesso revogado não alteram pagamento');
  console.log(`PASS: ${checks} verificações de confirmação de guias em PostgreSQL real; zero mensagens, e-mails ou consultas externas.`);
} finally {
  await client.appSetting.deleteMany({ where: { key: { in: [...settingKeys] } } });
  await client.arquivoWhatsapp.deleteMany({ where: { mensagem: { conversaId: { in: conversationIds } } } });
  await client.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: conversationIds } } });
  await client.conversaWhatsapp.deleteMany({ where: { id: { in: conversationIds } } });
  await client.contatoWhatsapp.deleteMany({ where: { portalClientId: { in: companyIds } } });
  await client.guide.deleteMany({ where: { id: { in: guideIds } } });
  await client.portalClient.deleteMany({ where: { id: { in: companyIds } } });
  await client.$disconnect();
}
