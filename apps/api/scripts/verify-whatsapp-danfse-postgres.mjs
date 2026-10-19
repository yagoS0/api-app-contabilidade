// Ensaio descartável: nenhuma emissão, mensagem real ou leitura de credenciais.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.match(url.pathname, /^\/[a-zA-Z0-9_]+_governance_test$/);
assert.equal(url.search, ''); assert.equal(url.hash, '');
url.hostname = '127.0.0.1';
process.env.DATABASE_URL = process.env.DIRECT_URL = url.toString();
process.env.DOTENV_CONFIG_PATH = join(tmpdir(), `altan-no-env-${randomUUID()}`);
assert.equal(existsSync(process.env.DOTENV_CONFIG_PATH), false);
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
for (const flag of readFileSync(new URL('../src/config.js', import.meta.url), 'utf8').match(/INTEGRACAO_[A-Z0-9_]+/g) || []) process.env[flag] = '0';
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw Error('Rede externa proibida'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
// Apenas o engine nativo Prisma acessa a URL loopback validada.
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { enviarDanfseWhatsapp } = await import('../src/application/whatsapp/EnvioDanfseWhatsappService.js');
const { gerarDanfseDaNota } = await import('../src/application/nfse/danfse/danfseDaNotaDoPortal.js');
const { WhatsappCloudClient } = await import('../src/application/whatsapp/WhatsappCloudClient.js');
const { aplicarStatusMensagem } = await import('../src/application/whatsapp/SaidaWhatsappService.js');
const { autorizarEmissaoDoCliente } = await import('../src/application/nfse/autorizacaoEmissaoDoCliente.js');
const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
const prefix = `danfse-test-${randomUUID()}`;
const xml = readFileSync(new URL('../../../docs/leiaute-nfse/nfse-nacional-substituicao.xml', import.meta.url), 'utf8');
const noLog = { info() {}, warn() {}, error() {} };
let posts = 0, uploads = 0, revokeDuringUpload = false, uncertain = false, rejectExplicit = false, disableChannelDuringUpload = false, unknownResponse = null;
try {
  const [database] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, url.pathname.slice(1));
  const owner = await db.client.create({ data: { name: prefix, email: `${prefix}@example.invalid`, login: prefix, passwordHash: 'SEM-LOGIN' } });
  const legacy = await db.company.create({ data: { clientId: owner.id, razaoSocial: 'SINTETICA SEM VALIDADE FISCAL', cnpj: prefix, atividades: [] } });
  const portal = await db.portalClient.create({ data: { companyId: legacy.id, cnpj: prefix, razao: 'SINTETICA', emissaoClienteLiberada: true } });
  const user = await db.user.create({ data: { email: `${prefix}-user@example.invalid`, passwordHash: 'SEM-LOGIN', accountType: 'CLIENT', status: 'active' } });
  await db.companyClientUser.create({ data: { companyId: portal.id, userId: user.id, role: 'CLIENT_ADMIN', status: 'ACTIVE' } });
  const canal = await db.canalWhatsapp.create({ data: { chave: prefix, finalidade: 'SUPORTE', ativo: true } });
  const conversa = await db.conversaWhatsapp.create({ data: { canalId: canal.id, portalClientId: portal.id, telefoneE164: '5521000000000', chaveEscopo: prefix, escopoVerificado: true } });
  const contato = await db.contatoWhatsapp.create({ data: { portalClientId: portal.id, userId: user.id, nome: 'SINTETICO', telefoneE164: conversa.telefoneE164, ativo: true, permissoesAssistente: ['EMISSAO_NFSE', 'NOTAS_DANFSE'] } });
  const entrada = async () => db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'text', corpo: 'DANFSe SINTETICO', providerMessageId: `synthetic-in-${randomUUID()}` } });
  const invoice = await db.serviceInvoice.create({ data: { companyId: legacy.id, tomadorDoc: '00000000000', tomadorNome: 'SINTETICO', valorServicos: 198, status: 'issued', numeroNfse: '18', chaveAcesso: '33045572200000000000191000000000001826011111111110', xml } });
  const action = await db.acaoPendenteWhatsapp.create({ data: { conversaId: conversa.id, portalClientId: portal.id, userId: user.id, tipo: 'EMITIR_NFSE', status: 'executada', codigo: 'TEST', payload: {}, textoDeConfirmacao: 'SINTETICO', expiraEm: new Date(), resultado: { status: 'issued', nfseId: invoice.id, indeterminado: false } } });
  const conferirAcesso = async () => {
    const autorizacao = await autorizarEmissaoDoCliente({ portalClientId: portal.id, userId: user.id, client: db });
    const atual = await db.contatoWhatsapp.findUnique({ where: { id: contato.id } });
    if (!autorizacao.ok || !atual?.ativo || !atual.permissoesAssistente.includes('NOTAS_DANFSE')) throw Object.assign(Error('Acesso revogado'), { codigo: 'ACESSO_REVOGADO' });
  };
  const cloud = new WhatsappCloudClient({ config: { habilitada: true, token: 'SINTETICO', phoneNumberId: 'SINTETICO', versao: 'v21.0', log: noLog }, conferirConsentimento: async () => {}, fetchImpl: async (address, options) => {
    if (String(address).endsWith('/media')) {
      uploads++;
      if (revokeDuringUpload) await db.user.update({ where: { id: user.id }, data: { status: 'rejected' } });
      if (disableChannelDuringUpload) await db.canalWhatsapp.update({ where: { id: canal.id }, data: { ativo: false } });
      return { ok: true, status: 200, json: async () => ({ id: `synthetic-media-${uploads}` }) };
    }
    assert.ok(String(address).endsWith('/messages'));
    const payload = JSON.parse(options.body);
    assert.equal(payload.to, conversa.telefoneE164); assert.equal(payload.type, 'document');
    posts++;
    if (unknownResponse) return { ok: false, status: unknownResponse, json: async () => { if (unknownResponse === 400) throw new SyntaxError('JSON sintético inválido'); return null; } };
    if (rejectExplicit) return { ok: false, status: 400, json: async () => ({ error: { code: 131047, message: 'Recusa sintética' } }) };
    if (uncertain) throw Object.assign(Error('Timeout sintético'), { name: 'AbortError' });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `synthetic-out-${prefix}-${posts}` }] }) };
  } });
  const gerar = args => gerarDanfseDaNota({ ...args, client: db });
  const send = async (message, extra = {}) => enviarDanfseWhatsapp({ conversa, notaId: invoice.id, mensagemEntradaId: message.id, client: db, cloud, conferirAcesso, gerar, ...extra });
  const first = await entrada();
  const concurrent = await Promise.allSettled([send(first, { acaoId: action.id }), send(first, { acaoId: action.id })]);
  assert.equal(posts, 1, 'Concorrência não duplica POST');
  const accepted = concurrent.find(r => r.status === 'fulfilled').value;
  assert.ok(accepted.wamid);
  const message = await db.mensagemWhatsapp.findUnique({ where: { providerMessageId: accepted.wamid } });
  assert.ok(message, 'Saída persiste correlação');
  const file = await db.arquivoWhatsapp.findUnique({ where: { mensagemId: message.id } });
  assert.ok(file?.conteudo?.length > 1000);
  assert.equal(file.sha256, createHash('sha256').update(file.conteudo).digest('hex'));
  const pdf = await pdfParse(Buffer.from(file.conteudo));
  assert.equal(pdf.numpages, 1); assert.match(pdf.text, /EMPRESA EXEMPLO/);
  await send(first, { acaoId: action.id });
  assert.equal(posts, 1, 'Replay confirmado só recupera comprovante');
  await aplicarStatusMensagem({ providerMessageId: accepted.wamid, status: 'read', client: db });
  await aplicarStatusMensagem({ providerMessageId: accepted.wamid, status: 'sent', client: db });
  await aplicarStatusMensagem({ providerMessageId: accepted.wamid, status: 'failed', client: db });
  assert.equal((await db.mensagemWhatsapp.findUnique({ where: { id: message.id } })).statusEnvio, 'lido');
  await send(await entrada()); assert.equal(posts, 2, 'Novo pedido explícito permite novo arquivo, não nova emissão');
  console.log('PASS: PDF real a partir de XML sintético, histórico/hash PostgreSQL, concorrência, replay, novo pedido e callbacks monotônicos.');

  revokeDuringUpload = true;
  await assert.rejects(send(await entrada()));
  assert.equal(posts, 2, 'Revogação durante upload bloqueia POST de mensagem');
  revokeDuringUpload = false;
  await db.user.update({ where: { id: user.id }, data: { status: 'active' } });
  // A entrega interrompida não altera a evidência fiscal.
  assert.equal((await db.serviceInvoice.findUnique({ where: { id: invoice.id } })).status, 'issued');
  const stopped = await db.mensagemWhatsapp.findFirst({ where: { conversaId: conversa.id, direcao: 'out' }, orderBy: { registradaEm: 'desc' } });
  assert.equal(stopped.statusEnvio, 'falhou', 'Interrupção comprovada não é resultado incerto');
  await send(await entrada());
  assert.equal(posts, 3, 'Nova entrada recupera documento interrompido antes do POST');
  await send(first, { acaoId: action.id });
  assert.equal(posts, 3, 'Recibo antigo continua idempotente após pedidos posteriores');
  console.log('PASS: revogação global durante upload impede envio e preserva nota issued.');

  const missingXml = await db.serviceInvoice.create({ data: { companyId: legacy.id, tomadorDoc: '00000000000', tomadorNome: 'SINTETICO', valorServicos: 198, status: 'issued', numeroNfse: '20' } });
  await assert.rejects(send(await entrada(), { notaId: missingXml.id }), { code: 'DANFSE_XML_INDISPONIVEL' });
  assert.equal(posts, 3);
  assert.equal((await db.serviceInvoice.findUnique({ where: { id: missingXml.id } })).status, 'issued');
  await db.serviceInvoice.update({ where: { id: missingXml.id }, data: { xml } });
  await send(await entrada(), { notaId: missingXml.id });
  assert.equal(posts, 4, 'XML recuperado permite entrega sem chamada fiscal');
  await db.contatoWhatsapp.update({ where: { id: contato.id }, data: { permissoesAssistente: ['EMISSAO_NFSE'] } });
  await assert.rejects(send(await entrada()));
  assert.equal(posts, 4, 'Permissão de emitir não implica permissão de obter documento');
  await db.contatoWhatsapp.update({ where: { id: contato.id }, data: { permissoesAssistente: ['EMISSAO_NFSE', 'NOTAS_DANFSE'] } });
  console.log('PASS: falha de PDF recupera documento após XML disponível e permissão documental é independente.');

  rejectExplicit = true;
  await assert.rejects(send(await entrada()));
  const afterRejection = posts;
  rejectExplicit = false;
  await send(await entrada());
  assert.equal(posts, afterRejection + 1, 'Recusa Meta comprovada não bloqueia permanentemente novo pedido');
  assert.equal((await db.serviceInvoice.findUnique({ where: { id: invoice.id } })).status, 'issued');
  console.log('PASS: recusa Meta HTTP400 permite recuperar somente a entrega com novo pedido.');

  disableChannelDuringUpload = true;
  const beforeChannelBlock = posts;
  await assert.rejects(send(await entrada()), { codigo: 'CANAL_DESABILITADO' });
  assert.equal(posts, beforeChannelBlock, 'Canal desativado durante upload impede POST');
  const blockedByChannel = await db.mensagemWhatsapp.findFirst({ where: { conversaId: conversa.id, direcao: 'out' }, orderBy: { registradaEm: 'desc' } });
  assert.equal(blockedByChannel.statusEnvio, 'falhou');
  disableChannelDuringUpload = false;
  await db.canalWhatsapp.update({ where: { id: canal.id }, data: { ativo: true } });
  await send(await entrada());
  assert.equal(posts, beforeChannelBlock + 1);
  assert.equal((await db.serviceInvoice.findUnique({ where: { id: invoice.id } })).status, 'issued');
  console.log('PASS: canal desativado durante upload bloqueia POST, registra falha comprovada e permite recuperação documental após regularização.');

  for (const status of [500, 400]) {
    const ambiguousInvoice = await db.serviceInvoice.create({ data: { companyId: legacy.id, tomadorDoc: '00000000000', tomadorNome: 'SINTETICO', valorServicos: 198, status: 'issued', numeroNfse: String(status), xml } });
    unknownResponse = status;
    await assert.rejects(send(await entrada(), { notaId: ambiguousInvoice.id }));
    const afterUnknownResponse = posts;
    unknownResponse = null;
    const ambiguousMessage = await db.mensagemWhatsapp.findFirst({ where: { conversaId: conversa.id, direcao: 'out' }, orderBy: { registradaEm: 'desc' } });
    assert.equal(ambiguousMessage.statusEnvio, 'indeterminado', 'Status HTTP não comprova recusa de mensagem');
    await assert.rejects(send(await entrada(), { notaId: ambiguousInvoice.id }));
    assert.equal(posts, afterUnknownResponse);
  }
  console.log('PASS: HTTP500 vazio e HTTP400 JSON inválido permanecem incertos, sem novo POST.');

  // Outra nota sintética evita converter uma reserva anterior em autorização.
  const otherInvoice = await db.serviceInvoice.create({ data: { companyId: legacy.id, tomadorDoc: '00000000000', tomadorNome: 'SINTETICO', valorServicos: 198, status: 'issued', numeroNfse: '19', xml } });
  uncertain = true;
  await assert.rejects(send(await entrada(), { notaId: otherInvoice.id }));
  const afterUnknown = posts;
  uncertain = false;
  await assert.rejects(send(await entrada(), { notaId: otherInvoice.id }));
  assert.equal(posts, afterUnknown, 'Nova entrada não repete uma saída incerta');
  assert.equal(networkAttempts, 0);
  console.log('PASS: timeout simulado permanece bloqueado entre pedidos; zero rede externa e zero ato fiscal.');
  console.log('LIMITES: nota issued inserida como fixture; autorização fiscal/Meta não acessados; integração de emissão é validada separadamente.');
} finally { await db.$disconnect(); }
// Fixtures conservadas apenas neste banco descartável para inspeção.

