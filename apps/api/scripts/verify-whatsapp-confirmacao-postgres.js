// PostgreSQL real descartável; dados sintéticos, modelo/transporte/atos fiscais sem rede.
// Requer migrate deploy e Prisma gerado. O alvo abaixo é fixo para impedir uso em produção.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { readdir } from "node:fs/promises";

const pos = process.argv.indexOf("--url");
const url = new URL(pos >= 0 ? process.argv[pos + 1] : "invalid:");
assert(url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.port === "55443"
  && url.pathname === "/altan_whatsapp_test" && url.username === "altan_test",
"Use apenas PostgreSQL de teste em 127.0.0.1:55443/altan_whatsapp_test, usuário altan_test.");
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = "test";
process.env.INTEGRACAO_WHATSAPP_IA = "0";
const redeProibida = () => { throw new Error("Provedores externos proibidos neste teste de banco"); };
globalThis.fetch = redeProibida;
http.request = http.get = https.request = https.get = redeProibida;

const { PrismaClient } = await import("@prisma/client");
const { prisma } = await import("../src/infrastructure/db/prisma.js");
const { criarPendencia, confirmarEExecutar, DEPS_PADRAO } = await import("../src/application/assistente/AcoesPendentesService.js");
const { responderMensagem } = await import("../src/application/assistente/AssistenteService.js");
const { TIPOS } = await import("../src/application/assistente/confirmacaoPendente.js");
const { TODAS_PERMISSOES_ASSISTENTE } = await import("../src/application/whatsapp/permissoesAssistente.js");
const recepcao = new PrismaClient({ datasources: { db: { url: url.href } } });
const prefixo = `confirmacao-check-${randomUUID()}`;
const empresas = [];
const conversas = [];
let usuario;
let checks = 0;
const log = { info() {}, warn() {}, error() {} };
const ok = (nome) => console.log(`PASS ${++checks}: ${nome}`);
const acoesDeps = { ...DEPS_PADRAO, autorizarEmissaoDoCliente: async () => ({ ok: true, via: "FIXTURE" }) };

async function novoCaso(nome) {
  const empresa = await prisma.portalClient.create({ data: { razao: `${prefixo} ${nome}`, cnpj: `${prefixo}-${nome}` } });
  empresas.push(empresa.id);
  const telefone = "5511999999988";
  await prisma.companyClientUser.create({ data: { companyId: empresa.id, userId: usuario.id, role: "CLIENT_ADMIN", status: "ACTIVE" } });
  await prisma.contatoWhatsapp.create({ data: { portalClientId: empresa.id, nome: "Contato sintético", telefoneE164: telefone, userId: usuario.id, permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE] } });
  const conversa = await prisma.conversaWhatsapp.create({ data: { portalClientId: empresa.id, telefoneE164: telefone, chaveEscopo: `empresa:${empresa.id}:${telefone}`, escopoVerificado: true } });
  conversas.push(conversa.id);
  const inicio = new Date(Date.now() - 15_000);
  const { acao } = await criarPendencia({ conversaId: conversa.id, portalClientId: empresa.id, userId: usuario.id, tipo: TIPOS.EMITIR_NFSE, payload: { fixture: true }, corpo: "Declaração fiscal exclusivamente sintética", agora: inicio, client: prisma });
  const entrada = (corpo, offset = 0, client = recepcao) => client.mensagemWhatsapp.create({ data: {
    conversaId: conversa.id, direcao: "in", tipo: "text", corpo, providerMessageId: `wamid.fixture.${randomUUID()}`,
    registradaEm: new Date(inicio.getTime() + offset), ocorridaEmProvedor: new Date(inicio.getTime() + offset),
  } });
  const mensagem = await entrada(`CONFIRMAR ${acao.codigo}`);
  let execucoes = 0;
  const executores = { [TIPOS.EMITIR_NFSE]: async () => { execucoes += 1; return { texto: "Ato fiscal simulado", filaHumana: false, resultado: { simulado: true } }; } };
  const confirmacao = { mensagemId: mensagem.id, registradaEm: mensagem.registradaEm, mensagensConhecidas: [mensagem.id] };
  const confirmar = (client = prisma) => confirmarEExecutar({ acaoId: acao.id, conversaId: conversa.id, portalClientId: empresa.id, confirmacao, client, log, executores, deps: acoesDeps });
  const responder = (client = prisma) => responderMensagem({ conversaId: conversa.id, mensagemId: mensagem.id, deps: {
    client, flag: true, piloto: [empresa.id], log, executores, acoesDeps,
    assistente: { responder: async () => { throw new Error("Confirmação não deve chamar o modelo"); } },
    cloud: { enviarTexto: async () => ({ wamid: `wamid.fixture.out.${randomUUID()}` }) },
  } });
  return { empresa, conversa, acao, mensagem, entrada, confirmar, responder, execucoes: () => execucoes };
}

try {
  const [server] = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS usuario, current_setting('server_version') AS versao`;
  assert.equal(server.db, "altan_whatsapp_test");
  assert.equal(server.usuario, "altan_test");
  assert.match(server.versao, /^16\./);
  const migrations = await prisma.$queryRaw`SELECT migration_name AS nome FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const esperadas = (await readdir(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
  assert.deepEqual(migrations.map(item => item.nome).sort(), esperadas);
  ok(`PostgreSQL ${server.versao}: histórico completo de ${migrations.length} migrations`);
  usuario = await prisma.user.create({ data: { email: `${prefixo}@example.invalid`, passwordHash: "INUTILIZAVEL-FIXTURE", status: "active" } });

  const valido = await novoCaso("valida");
  assert.equal((await valido.responder()).motivo, "EXECUTADA");
  assert.equal(valido.execucoes(), 1);
  assert.equal((await valido.confirmar()).executou, false);
  assert.equal(valido.execucoes(), 1);
  assert.equal((await prisma.acaoPendenteWhatsapp.findUnique({ where: { id: valido.acao.id } })).mensagemConfirmacaoId, valido.mensagem.id);
  ok("turno real confirma, registra mensagem de autorização e reentrega não executa novamente");

  const concorrente = await novoCaso("concorrentes");
  const corridas = await Promise.all(Array.from({ length: 12 }, (_, i) => concorrente.confirmar(i % 2 ? recepcao : prisma)));
  assert.equal(corridas.filter(r => r.executou).length, 1);
  assert.equal(concorrente.execucoes(), 1);
  ok("12 confirmações em conexões reais concorrentes executam uma única vez");

  const duplicatas = await novoCaso("duplicatas");
  await duplicatas.entrada(`confirmar ${duplicatas.acao.codigo.toLowerCase()}.`, 9_000);
  await duplicatas.entrada(` CONFIRMAR ${duplicatas.acao.codigo} `, 10_000);
  assert.equal((await duplicatas.responder()).motivo, "EXECUTADA");
  assert.equal(duplicatas.execucoes(), 1);
  ok("duplicatas textuais válidas após 8 segundos continuam autorizando o mesmo ato uma vez");

  const corrigida = await novoCaso("duplicata-correcao");
  await corrigida.entrada(`CONFIRMAR ${corrigida.acao.codigo}`, 9_000);
  await corrigida.entrada("Espera, o valor está errado", 10_000);
  assert.equal((await corrigida.responder()).motivo, "CONFIRMACAO_SUPERADA");
  assert.equal(corrigida.execucoes(), 0);
  ok("duplicata não esconde correção posterior já persistida");

  const empatada = await novoCaso("timestamp-igual");
  await Promise.all(Array.from({ length: 13 }, () => empatada.entrada(`CONFIRMAR ${empatada.acao.codigo}`, 0)));
  await empatada.entrada("O valor precisa mudar", 0);
  assert.equal((await empatada.responder()).feito, true);
  assert.equal(empatada.execucoes(), 0);
  ok("timestamp empatado e mais de 12 bolhas nunca autorizam correção omitida do agrupamento");

  const entreLeituraEReserva = await novoCaso("corrida-correcao");
  let interceptacoes = 0;
  // Intercepta somente a chegada ao comando de reserva. A correção COMMITA em outra conexão
  // e depois o Prisma original executa SQL real com a relação mensagens.none.
  const clientComBarreira = prisma.$extends({ query: { acaoPendenteWhatsapp: { async updateMany({ args, query }) {
    if (args.where.id === entreLeituraEReserva.acao.id && args.data.status === "confirmada") {
      interceptacoes += 1;
      await entreLeituraEReserva.entrada("Espera, preciso corrigir o pedido", 15_000);
    }
    return query(args);
  } } } });
  assert.equal((await entreLeituraEReserva.responder(clientComBarreira)).motivo, "CONFIRMACAO_SUPERADA");
  assert.equal(interceptacoes, 1);
  assert.equal(entreLeituraEReserva.execucoes(), 0);
  assert.equal((await prisma.acaoPendenteWhatsapp.findUnique({ where: { id: entreLeituraEReserva.acao.id } })).status, "cancelada");
  ok("correção commitada por outra conexão entre leitura e UPDATE bloqueia a reserva relacional real");

  const assumida = await novoCaso("assumida");
  await recepcao.conversaWhatsapp.update({ where: { id: assumida.conversa.id }, data: { atendidaPor: usuario.id, atendidaDesde: new Date() } });
  assert.equal((await assumida.confirmar()).executou, false);
  assert.equal(assumida.execucoes(), 0);
  ok("atendimento humano assumido depois da leitura bloqueia a reserva fiscal");

  console.log(`PASS: ${checks} verificações PostgreSQL reais; nenhum modelo, WhatsApp ou ato fiscal externo.`);
} finally {
  if (conversas.length) {
    await prisma.whatsappLease.deleteMany({ where: { id: { in: conversas.map(id => `ia:${id}`) } } });
    await prisma.conversaWhatsapp.deleteMany({ where: { id: { in: conversas } } });
  }
  if (empresas.length) await prisma.portalClient.deleteMany({ where: { id: { in: empresas } } });
  if (usuario) await prisma.user.delete({ where: { id: usuario.id } });
  await recepcao.$disconnect();
  await prisma.$disconnect();
}
