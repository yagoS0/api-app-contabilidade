// Banco descartável local, sem .env e sem chamadas Meta. Requer migrate deploy + prisma generate.
// node scripts/verify-whatsapp-delivery-postgres.js --url postgresql://whatsapp_check@127.0.0.1:55439/whatsapp_delivery_check
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { registrarEnvio, marcarEnviando, marcarEnviado, marcarIndeterminado,
  aplicarStatusDoProvedor, aplicarFalhaDoProvedor } from "../src/application/guides/EnvioGuiaService.js";

const arg = process.argv.indexOf("--url");
const url = new URL(arg >= 0 ? process.argv[arg + 1] : "invalid:");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55439"
  || url.pathname !== "/whatsapp_delivery_check" || url.username !== "whatsapp_check") {
  throw new Error("Use somente whatsapp_delivery_check em 127.0.0.1:55439, usuário whatsapp_check.");
}
const client = new PrismaClient({ datasources: { db: { url: url.href } } });
const guideIds = [];
let checks = 0;
const ok = (nome) => console.log(`OK ${++checks}: ${nome}`);
const novaGuia = async () => {
  const guia = await client.guide.create({ data: { tipo: "OUTRA", source: "LOCAL" } });
  guideIds.push(guia.id);
  return guia;
};
const pedido = (guideId, reenviar = false) => registrarEnvio({ guideId, canal: "WHATSAPP", destino: "destinatario-sintetico", reenviar, tx: client });
try {
  const [server] = await client.$queryRaw`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(server.db, "whatsapp_delivery_check");
  assert((server.host === "127.0.0.1" && server.port === 55439)
    || (process.env.CI === "true" && server.port === 5432 && /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(server.host)), "Servidor deve ser o cluster local ou serviço Docker do CI");
  const migrations = await client.$queryRaw`SELECT count(*)::int AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert(migrations[0].total >= 156, "Histórico de migrations deve estar aplicado");
  ok("histórico de migrations aplicado na base descartável validada");

  const guia = await novaGuia();
  const pedidos = await Promise.all(Array.from({ length: 12 }, () => pedido(guia.id)));
  assert.equal(new Set(pedidos.map((r) => r.envio.id)).size, 1);
  assert.equal(await client.envioGuia.count({ where: { guideId: guia.id } }), 1);
  ok("12 cadastros paralelos materializam um único envio");
  const envioId = pedidos[0].envio.id;
  const reservas = await Promise.all(Array.from({ length: 12 }, () => marcarEnviando(envioId, client)));
  assert.equal(reservas.filter((r) => r.reservado).length, 1);
  assert.equal(await client.envioGuiaTentativa.count({ where: { envioGuiaId: envioId } }), 1);
  const a = reservas.find((r) => r.reservado);
  assert.equal((await client.envioGuia.findUnique({ where: { id: envioId } })).tentativas, 1);
  ok("12 reservas transacionais paralelas autorizam uma única tentativa");

  assert.equal((await pedido(guia.id, true)).emAndamento, true);
  assert.equal((await marcarEnviando(envioId, client)).reservado, false);
  ok("reenvio explícito durante envio não reabre a reserva");
  const wamid = `wamid-sintetico-${randomUUID()}`;
  await marcarEnviado({ envioId, tentativaId: a.tentativaId, providerMessageId: wamid }, client);
  await aplicarFalhaDoProvedor({ providerMessageId: wamid, codigo: "FALHA_TESTE" }, client);
  await aplicarStatusDoProvedor({ providerMessageId: wamid, status: "sent" }, client);
  assert.equal((await client.envioGuia.findUnique({ where: { id: envioId } })).status, "falhou");
  ok("sent atrasado não apaga falha confirmada");

  await pedido(guia.id);
  const b = await marcarEnviando(envioId, client);
  await aplicarStatusDoProvedor({ providerMessageId: wamid, status: "read" }, client);
  const atual = await client.envioGuia.findUnique({ where: { id: envioId } });
  assert.equal(atual.tentativaAtualId, b.tentativaId);
  assert.equal(atual.status, "enviando");
  assert.equal(atual.lidoEm, null);
  assert.equal((await client.envioGuiaTentativa.findUnique({ where: { id: a.tentativaId } })).status, "lido");
  ok("callback antigo atualiza só sua tentativa, preservando a atual");

  const atualWamid = `wamid-sintetico-${randomUUID()}`;
  await marcarIndeterminado({ envioId, tentativaId: b.tentativaId, providerMessageId: atualWamid, mensagemUsuario: "Conferir" }, client);
  assert.equal((await pedido(guia.id, true)).emAndamento, true);
  await Promise.all(["delivered", "read"].map((status) => aplicarStatusDoProvedor({ providerMessageId: atualWamid, status }, client)));
  await aplicarFalhaDoProvedor({ providerMessageId: atualWamid, codigo: "FALHA_ATRASADA" }, client);
  assert.equal((await client.envioGuia.findUnique({ where: { id: envioId } })).status, "lido");
  assert.equal((await client.envioGuiaTentativa.findUnique({ where: { id: b.tentativaId } })).status, "lido");
  ok("indeterminado bloqueia duplicação e callbacks concorrentes terminam em leitura");

  // Repetição com barreira de Promise.all abre transações em conexões independentes.
  for (let i = 0; i < 10; i += 1) {
    await pedido(guia.id, true);
    const tentativa = await marcarEnviando(envioId, client);
    const id = `wamid-corrida-${randomUUID()}`;
    await marcarEnviado({ envioId, tentativaId: tentativa.tentativaId, providerMessageId: id }, client);
    await Promise.all(["sent", "read", "delivered"].map((status) => aplicarStatusDoProvedor({ providerMessageId: id, status }, client)));
    assert.equal((await client.envioGuia.findUnique({ where: { id: envioId } })).status, "lido");
  }
  ok("10 corridas de sent/read/delivered mantêm estado monotônico no PostgreSQL");
  console.log(`PASS: ${checks} verificações; nenhuma mensagem externa.`);
} finally {
  if (guideIds.length) await client.guide.deleteMany({ where: { id: { in: guideIds } } });
  await client.$disconnect();
}
