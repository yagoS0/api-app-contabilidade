// Ensaio local real: nenhum token de modelo, mensagem ou documento fiscal real.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const argumento = process.argv.indexOf('--url');
const url = new URL(argumento >= 0 ? process.argv[argumento + 1] : 'invalid:');
const local = url.port === '55443' && url.pathname === '/comunicacao_v2_check' && url.username === 'lead_test';
const ci = url.port === '55439' && url.pathname === '/whatsapp_delivery_check' && url.username === 'whatsapp_check';
assert(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && (local || ci), 'Use apenas o banco descartável local ou da CI.');
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: 'test', LOG_LEVEL: 'fatal',
  WHATSAPP_IDENTIDADE_V2: '1', WHATSAPP_MULTICANAL: '1', INTEGRACAO_WHATSAPP: '0',
  INTEGRACAO_WHATSAPP_IA: '0', INTEGRACAO_IA_COMERCIAL: '0', WHATSAPP_PHONE_NUMBER_ID: 'fixture-channel',
  WHATSAPP_WABA_ID: 'fixture-waba', WHATSAPP_TOKEN: 'fake-local-token', WHATSAPP_TESTE_TOKEN: 'fake-secondary-token',
  ANTHROPIC_API_KEY: 'TESTE-SEM-MODELO', OPENAI_API_KEY: 'TESTE-SEM-MODELO' });
const semRede = () => { throw new Error('Rede proibida no ensaio local.'); };
globalThis.fetch = semRede;
http.request = http.get = https.request = https.get = semRede;
const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { garantirConversa, registrarMensagemRecebida, janelaDaConversa } = await import('../src/application/whatsapp/ConversaWhatsappService.js');
const { garantirAtendimentoResponsavel, conferirContextoResponsavel, encaminharResponsavelParaEquipe, alterarAtendimentoHumano } = await import('../src/application/whatsapp/AtendimentoResponsavelWhatsappService.js');
const { conferirIdentificacao } = await import('../src/application/whatsapp/IdentidadeComunicacaoService.js');
const { resolverCanalEntrada, whatsappPorCanal, conferirCanalDoRecibo } = await import('../src/application/whatsapp/CanalWhatsappService.js');
const { enviarMensagemRastreada } = await import('../src/application/whatsapp/SaidaWhatsappService.js');
const { processarEventoWhatsapp } = await import('../src/application/whatsapp/ProcessarEventoWhatsappService.js');
const prefixo = 'canais-test-' + randomUUID();
const telefone = '55219' + (BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)) % 100000000n).toString().padStart(8, '0');
let checks = 0;
const ok = nome => console.log('PASS ' + (++checks) + ': ' + nome);
const rejeita = (p, codigo) => assert.rejects(p, e => (e.code || e.codigo) === codigo);
const canalId = prefixo;
const entrada = (canal, wamid, ocorridaEmProvedor = new Date()) => registrarMensagemRecebida({ telefone, canalId: canal, tipo: 'text', corpo: 'Olá', providerMessageId: prefixo + wamid, ocorridaEmProvedor });
try {
  const [alvo] = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  assert.equal(alvo.db, url.pathname.slice(1));
  await prisma.canalWhatsapp.create({ data: { id: canalId, chave: prefixo, phoneNumberId: prefixo, wabaId: 'fixture-waba', referenciaCredencial: 'WHATSAPP_TESTE_TOKEN', finalidade: 'COMERCIAL' } });
  assert.equal((await resolverCanalEntrada('fixture-channel', { wabaProvedorId: 'fixture-waba' })).id, 'principal');
  assert.equal((await resolverCanalEntrada(prefixo, { wabaProvedorId: 'fixture-waba' })).id, canalId);
  await rejeita(resolverCanalEntrada(prefixo, { wabaProvedorId: 'outra-conta' }), 'CONTA_WHATSAPP_DIVERGENTE');
  await rejeita(resolverCanalEntrada('desconhecido'), 'CANAL_DIVERGENTE');
  await rejeita(resolverCanalEntrada(null), 'CANAL_AUSENTE');
  const transporte = await whatsappPorCanal(canalId);
  assert.equal(transporte.phoneNumberId, prefixo);
  ok('Canal reconhecido por número e conta; destino desconhecido e conta divergente recusados.');
  const primeiro = await entrada('principal', '-in1');
  const segundo = await garantirConversa({ telefone, canalId });
  assert.equal(segundo.vinculoNumeroId, primeiro.conversa.vinculoNumeroId);
  assert.notEqual(segundo.id, primeiro.conversa.id);
  assert.equal((await janelaDaConversa(primeiro.conversa.id)).situacao, 'ABERTA');
  assert.equal((await janelaDaConversa(segundo.id)).situacao, 'NUNCA_ABERTA');
  await entrada(canalId, '-in2');
  assert.equal((await janelaDaConversa(segundo.id)).situacao, 'ABERTA');
  await rejeita(entrada(canalId, '-in1'), 'MENSAGEM_CANAL_DIVERGENTE');
  assert.equal((await entrada('principal', '-in1')).duplicada, true);
  ok('Janela separada por canal; reentrega não duplica nem migra a mensagem.');
  const saida = await enviarMensagemRastreada({ conversa: segundo, autor: 'HUMANO', corpo: 'Resposta fictícia',
    enviar: async () => ({ wamid: prefixo + '-out' }) });
  assert(saida.mensagem?.id);
  await conferirCanalDoRecibo({ providerMessageId: prefixo + '-out', canalProvedorId: prefixo, wabaProvedorId: 'fixture-waba' });
  await rejeita(conferirCanalDoRecibo({ providerMessageId: prefixo + '-out', canalProvedorId: 'fixture-channel' }), 'RECIBO_CANAL_DIVERGENTE');
  ok('Saída guarda canal original; recibo de outro número não altera entrega.');
  const quando = new Date();
  await encaminharResponsavelParaEquipe({ conversa: primeiro.conversa, quando });
  await rejeita(conferirContextoResponsavel({ conversa: segundo }), 'ASSUMIDA_POR_HUMANO');
  await conferirContextoResponsavel({ conversa: primeiro.conversa, permitirHandoffEm: quando });
  const sessao1 = await garantirAtendimentoResponsavel({ conversa: primeiro.conversa });
  const sessao2 = await garantirAtendimentoResponsavel({ conversa: segundo });
  assert.notEqual(sessao1.id, sessao2.id);
  await alterarAtendimentoHumano({ conversa: { ...primeiro.conversa, atendimentoId: sessao1.id } });
  assert.equal((await prisma.conversaWhatsapp.findUnique({ where: { id: segundo.id } })).atendidaDesde, null);
  ok('Handoff pausa ambos os canais; devolução libera o interlocutor e invalida as seleções anteriores.');
  const antes = await prisma.vinculoNumeroInterlocutor.findUnique({ where: { id: segundo.vinculoNumeroId }, include: { interlocutor: true } });
  const novo = await conferirIdentificacao({ vinculoNumeroId: antes.id, versao: antes.interlocutor.versao, acao: 'NOVO_TITULAR', evidencia: 'Ensaio sintético de troca de titular', atorId: 'operador-teste' });
  const novaConversa = await garantirConversa({ telefone, canalId });
  assert.notEqual(novaConversa.vinculoNumeroId, antes.id);
  assert.equal(novaConversa.vinculoNumeroId, novo.vinculoNumero.id);
  assert.equal((await janelaDaConversa(novaConversa.id)).situacao, 'NUNCA_ABERTA');
  let enviou = false;
  await rejeita(enviarMensagemRastreada({ conversa: segundo, autor: 'HUMANO', corpo: 'Rascunho antigo', enviar: async () => { enviou = true; } }), 'IDENTIDADE_ALTERADA');
  assert.equal(enviou, false);
  await rejeita(entrada(canalId, '-atrasada', new Date(Date.now() - 60000)), 'IDENTIDADE_EVENTO_ANTERIOR');
  ok('Novo titular não herda janela, saída antiga ou mensagem atrasada.');
  const payload = { object: 'whatsapp_business_account', entry: [{ id: 'fixture-waba', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: prefixo }, messages: [{ from: telefone, id: prefixo + '-webhook', timestamp: String(Math.ceil(Date.now() / 1000)), type: 'text', text: { body: 'Olá' } }] } }] }] };
  await processarEventoWhatsapp(payload, { log: { info() {}, warn() {}, error() {}, debug() {} } });
  const recebida = await prisma.mensagemWhatsapp.findUnique({ where: { providerMessageId: prefixo + '-webhook' }, include: { conversa: true } });
  assert.equal(recebida?.conversa.canalId, canalId);
  assert.equal(recebida?.conversa.vinculoNumeroId, novo.vinculoNumero.id);
  ok('Webhook completo persiste no canal e na vigência atual sem chamar provedor externo.');
  await prisma.canalWhatsapp.update({ where: { id: canalId }, data: { ativo: false } });
  await rejeita(whatsappPorCanal(canalId), 'CANAL_DESABILITADO');
  ok('Desativar canal bloqueia novas saídas.');
  console.log(JSON.stringify({ ok: true, checks, banco: alvo.db, rede: 'bloqueada', prefixo }));
} finally { await prisma.$disconnect(); }
