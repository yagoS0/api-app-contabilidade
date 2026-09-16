// Persistência real e fornecedores sintéticos. Não usa .env, IA ou transporte externo.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const pos = process.argv.indexOf('--url');
const url = new URL(pos >= 0 ? process.argv[pos + 1] : 'invalid:');
assert(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === '55439'
  && url.pathname === '/whatsapp_delivery_check' && url.username === 'whatsapp_check', 'Somente banco descartável local de teste.');
process.env.DATABASE_URL = url.href;
process.env.DOTENV_CONFIG_PATH = '/arquivo-de-teste-inexistente';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
process.env.INTEGRACAO_WHATSAPP = '0';
process.env.INTEGRACAO_WHATSAPP_IA = '0';
const proibido = () => { throw new Error('Rede externa proibida neste teste'); };
globalThis.fetch = http.request = http.get = https.request = https.get = proibido;
const { PrismaClient } = await import(process.env.WHATSAPP_TEST_PRISMA_MODULE || '@prisma/client');
const { criarComunicadosWhatsapp } = await import('../src/application/whatsapp/ComunicadosWhatsappService.js');
const { aplicarStatusMensagem, enviarMensagemRastreada } = await import('../src/application/whatsapp/SaidaWhatsappService.js');
const client = new PrismaClient({ datasources: { db: { url: url.href } } });
const prefixo = `comunicado-test-${randomUUID()}`;
const empresas = [], avisos = [], modelos = new Map(), chamadas = [];
let usuario, modo = 'ok', antes = null, metaFalha = false, criarIncerto = false, checks = 0, submissoes = 0;
const ok = nome => console.log(`PASS ${++checks}: ${nome}`);
const meta = {
  async consultar(nome) { if (metaFalha) throw new Error('offline'); return modelos.get(nome) || null; },
  async criar(m) { submissoes++; const retorno = { ...m, id: randomUUID(), status: 'PENDING' }; modelos.set(m.name, retorno); if (criarIncerto) throw new Error('Resposta perdida após criação'); return retorno; },
};
const cloud = { async enviarTemplate(dados) {
  chamadas.push(dados);
  if (modo === 'timeout') throw new Error('timeout sintético');
  if (modo === 'recusado') throw Object.assign(new Error('recusado'), { traducao: { httpStatus: 400 }, mensagemUsuario: 'Recusa sintética' });
  return { wamid: `wamid.fixture.${randomUUID()}` };
} };
const servico = criarComunicadosWhatsapp({ client, meta, cloud,
  enviar: async args => { if (antes) await antes(); return enviarMensagemRastreada(args); } });
const detalhe = id => servico.detalhe(id, empresas);
const criar = async (extra = {}) => {
  const input = { titulo: 'Aviso sintético', corpo: 'Comunicado de teste, sem envio real.', categoria: 'MARKETING',
    idempotencia: randomUUID(), empresasIds: empresas, telefones: ['5521999998800'], ...extra };
  const c = await servico.criar(input, empresas, usuario.id); avisos.push(c.id); return { c, input };
};
const aprovar = async c => {
  await servico.submeter(c.id, empresas);
  modelos.get(c.nomeMeta).status = 'APPROVED';
  return servico.consultar(c.id, empresas);
};
const preparar = async () => { const { c } = await criar(); const a = await aprovar(c); return servico.confirmar(a.id, empresas, a.previaHash, usuario.id); };
const concluir = async c => { await servico.processarUmaVez(); await servico.cancelar(c.id, empresas); };
try {
  const [db] = await client.$queryRaw`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(db.db, 'whatsapp_delivery_check');
  assert(db.host === '127.0.0.1' && db.port === 55439 || process.env.CI === 'true' && db.port === 5432 && /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(db.host));
  usuario = await client.user.create({ data: { email: `${prefixo}@example.invalid`, name: 'Operador sintético', role: 'contador', status: 'active', accountType: 'FIRM', passwordHash: 'teste-sem-login' } });
  for (const nome of ['Klaus sintético', 'Lente sintética', 'Alessandro sintético']) {
    const e = await client.portalClient.create({ data: { razao: nome, cnpj: `${prefixo}-${nome}` } }); empresas.push(e.id);
    await client.contatoWhatsapp.create({ data: { portalClientId: e.id, nome: 'Liz sintética', telefoneE164: '5521999998800', optInEm: new Date(), ativo: true } });
  }
  const outro = await client.contatoWhatsapp.create({ data: { portalClientId: empresas[0], nome: 'Outro sintético', telefoneE164: '5521999998811', optInEm: new Date(), ativo: true } });
  await client.contatoWhatsapp.create({ data: { portalClientId: empresas[0], nome: 'Sem consentimento', telefoneE164: '5521999998822', ativo: true } });
  const publico = await servico.audiencia({}, empresas);
  assert.equal(publico.destinatarios.length, 2); assert.equal(publico.excluidos.length, 1);
  assert.equal(publico.destinatarios.find(d => d.nome === 'Liz sintética').empresasIds.length, 3);
  await assert.rejects(servico.audiencia({ empresasIds: ['invisivel'] }, empresas));
  await assert.rejects(servico.audiencia({ empresasIds: 'string' }, empresas));
  await assert.rejects(servico.audiencia({ telefones: ['5521999998822'] }, empresas));
  ok('três empresas, dois números, sem associação ao portal; escopo e opt-in respeitados');

  const { c, input } = await criar({ telefones: ['5521999998800', '5521999998811'] });
  const duplicados = await Promise.all(Array.from({ length: 6 }, () => servico.criar(input, empresas, usuario.id)));
  assert(duplicados.every(r => r.id === c.id)); assert.equal(await client.destinatarioComunicadoWhatsapp.count({ where: { comunicadoId: c.id } }), 2);
  await assert.rejects(servico.criar({ ...input, telefones: [outro.telefoneE164] }, empresas, usuario.id), e => e.status === 409);
  await assert.rejects(servico.detalhe(c.id, [empresas[0]]), e => e.status === 404);
  await assert.rejects(servico.confirmar(c.id, empresas, c.previaHash, usuario.id));
  await Promise.allSettled(Array.from({ length: 6 }, () => servico.submeter(c.id, empresas)));
  assert.equal(submissoes, 1); assert.equal(chamadas.length, 0);
  await assert.rejects(servico.confirmar(c.id, empresas, c.previaHash, usuario.id));
  modelos.get(c.nomeMeta).status = 'APPROVED';
  let a = await servico.consultar(c.id, empresas);
  await assert.rejects(servico.confirmar(c.id, empresas, 'hash-antigo', usuario.id));
  await Promise.allSettled(Array.from({ length: 6 }, () => servico.confirmar(c.id, empresas, a.previaHash, usuario.id)));
  for (let i = 0; i < 3; i++) await Promise.all(Array.from({ length: 8 }, () => servico.processarUmaVez()));
  assert.equal(chamadas.length, 2); assert.equal(new Set(chamadas.map(c => c.telefone)).size, 2);
  a = await detalhe(c.id); assert.equal(a.status, 'CONCLUIDO'); assert(a.destinatarios.every(d => d.status === 'ENVIADO'));
  const mensagem = await client.mensagemWhatsapp.findUnique({ where: { id: a.destinatarios[0].mensagemId } });
  await aplicarStatusMensagem({ providerMessageId: mensagem.providerMessageId, status: 'read', client });
  await aplicarStatusMensagem({ providerMessageId: mensagem.providerMessageId, status: 'sent', client });
  assert.equal((await detalhe(c.id)).destinatarios.find(d => d.mensagemId === mensagem.id).entrega, 'lido');
  await servico.confirmar(c.id, empresas, a.previaHash, usuario.id); await servico.processarUmaVez(); assert.equal(chamadas.length, 2);
  ok('submissão/confirmacão/worker concorrentes enviam uma vez; recibos fora de ordem não rebaixam leitura');

  const incerto = await criar(); criarIncerto = true; const submetidos = submissoes;
  await assert.rejects(servico.submeter(incerto.c.id, empresas));
  await assert.rejects(servico.submeter(incerto.c.id, empresas));
  assert.equal(submissoes, submetidos + 1); assert.equal((await detalhe(incerto.c.id)).status, 'SUBMETENDO');
  criarIncerto = false; modelos.get(incerto.c.nomeMeta).status = 'APPROVED';
  assert.equal((await servico.consultar(incerto.c.id, empresas)).status, 'APROVADO');
  await servico.cancelar(incerto.c.id, empresas);
  ok('resposta perdida na criação do modelo é recuperada por consulta, sem repetir submissão');

  let caso = await criar(); a = await aprovar(caso.c);
  modelos.get(a.nomeMeta).category = 'UTILITY';
  await assert.rejects(servico.confirmar(a.id, empresas, a.previaHash, usuario.id));
  const novo = await servico.consultar(a.id, empresas); assert.equal(novo.categoria, 'UTILITY'); assert.notEqual(novo.previaHash, a.previaHash);
  modelos.get(a.nomeMeta).components[0].text = 'Texto alterado fora do portal';
  await assert.rejects(servico.confirmar(a.id, empresas, novo.previaHash, usuario.id));
  await servico.cancelar(a.id, empresas);
  ok('aprovação de outro texto e mudança de categoria impedem usar confirmação antiga');

  caso = await criar({ telefones: [outro.telefoneE164] }); a = await aprovar(caso.c);
  await client.contatoWhatsapp.update({ where: { id: outro.id }, data: { optInEm: null } });
  await assert.rejects(servico.confirmar(a.id, empresas, a.previaHash, usuario.id));
  await servico.cancelar(a.id, empresas);
  await client.contatoWhatsapp.update({ where: { id: outro.id }, data: { optInEm: new Date() } });
  a = await preparar(); const chamadasAntes = chamadas.length;
  antes = async () => client.contatoWhatsapp.updateMany({ where: { telefoneE164: '5521999998800', portalClientId: { in: empresas } }, data: { optInEm: null } });
  await concluir(a); antes = null; assert.equal(chamadas.length, chamadasAntes);
  assert.equal((await detalhe(a.id)).destinatarios[0].status, 'EXCLUIDO');
  await client.contatoWhatsapp.updateMany({ where: { telefoneE164: '5521999998800', portalClientId: { in: empresas } }, data: { optInEm: new Date() } });
  ok('revogação de opt-in invalida prévia e é rechecada imediatamente antes da rede');

  a = await preparar(); antes = async () => servico.cancelar(a.id, empresas);
  await servico.processarUmaVez(); antes = null; assert.equal(chamadas.length, chamadasAntes);
  a = await preparar(); await client.user.update({ where: { id: usuario.id }, data: { status: 'blocked' } });
  await servico.processarUmaVez(); assert.equal((await detalhe(a.id)).status, 'PAUSADO'); assert.equal(chamadas.length, chamadasAntes);
  await servico.cancelar(a.id, empresas); await client.user.update({ where: { id: usuario.id }, data: { status: 'active' } });
  a = await preparar(); await client.user.update({ where: { id: usuario.id }, data: { accountType: 'CLIENT' } });
  await servico.processarUmaVez(); assert.equal((await detalhe(a.id)).status, 'PAUSADO'); assert.equal(chamadas.length, chamadasAntes);
  await servico.cancelar(a.id, empresas); await client.user.update({ where: { id: usuario.id }, data: { accountType: 'FIRM' } });
  ok('cancelamento em corrida e operador desabilitado interrompem a transmissão');

  for (const [tipo, esperado] of [['timeout', 'INDETERMINADO'], ['recusado', 'FALHOU']]) {
    a = await preparar(); modo = tipo; const n = chamadas.length;
    await servico.processarUmaVez(); await servico.processarUmaVez(); await servico.processarUmaVez();
    assert.equal((await detalhe(a.id)).destinatarios[0].status, esperado); assert.equal(chamadas.length, n + 1);
  }
  modo = 'ok'; ok('timeout é indeterminado, rejeição HTTP é falha; nenhum dos dois é reenviado');

  a = await preparar(); metaFalha = true; const n = chamadas.length;
  await servico.processarUmaVez(); assert.equal((await detalhe(a.id)).status, 'PAUSADO'); assert.equal(chamadas.length, n);
  metaFalha = false; await servico.cancelar(a.id, empresas);
  a = await preparar(); await client.destinatarioComunicadoWhatsapp.updateMany({ where: { comunicadoId: a.id }, data: { status: 'ENVIANDO', iniciadoEm: new Date(Date.now() - 16 * 60000) } });
  await servico.processarUmaVez(); assert.equal((await detalhe(a.id)).destinatarios[0].status, 'INDETERMINADO'); assert.equal(chamadas.length, n);
  ok('indisponibilidade da Meta pausa; reinício não repete reserva sem resultado');

  const tudo = await servico.listar(empresas); assert(tudo.itens.some(i => i.id === a.id));
  console.log(`OK: ${checks} cenários PostgreSQL; ${chamadas.length} chamadas sintéticas, zero rede externa.`);
} finally {
  const fios = await client.conversaWhatsapp.findMany({ where: { portalClientId: { in: empresas } }, select: { id: true } });
  await client.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: fios.map(f => f.id) } } });
  await client.whatsappLease.deleteMany({ where: { id: { in: fios.map(f => `ia:${f.id}`) } } });
  await client.conversaWhatsapp.deleteMany({ where: { id: { in: fios.map(f => f.id) } } });
  await client.destinatarioComunicadoWhatsapp.deleteMany({ where: { comunicadoId: { in: avisos } } });
  await client.comunicadoWhatsapp.deleteMany({ where: { id: { in: avisos } } });
  await client.contatoWhatsapp.deleteMany({ where: { portalClientId: { in: empresas } } });
  await client.portalClient.deleteMany({ where: { id: { in: empresas } } });
  if (usuario) await client.user.delete({ where: { id: usuario.id } });
  await client.$disconnect();
}
