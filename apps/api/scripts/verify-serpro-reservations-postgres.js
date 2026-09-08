// Somente banco descartável com migrations aplicadas; nunca envia HTTP nem carrega .env.
// node scripts/verify-serpro-reservations-postgres.js --url postgresql://whatsapp_check@127.0.0.1:55439/whatsapp_delivery_check
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const arg = process.argv.indexOf("--url");
const url = new URL(arg >= 0 ? process.argv[arg + 1] : process.env.DATABASE_URL || "invalid:");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55439"
  || url.pathname !== "/whatsapp_delivery_check" || url.username !== "whatsapp_check") {
  throw new Error("Use somente whatsapp_delivery_check em 127.0.0.1:55439, usuário whatsapp_check.");
}
// Config precisa ser definida antes do import dinâmico do guard. Caminho aleatório inexistente
// impede o loader legado de consultar arquivos .env do desenvolvedor ou do workspace.
Object.assign(process.env, {
  DATABASE_URL: url.href, DOTENV_CONFIG_PATH: path.join(tmpdir(), `serpro-no-env-${randomUUID()}`),
  NODE_ENV: "test", LOG_LEVEL: "silent", SERPRO_GUARDA_ATIVA: "1", SERPRO_COOLDOWN_SEGUNDOS: "300",
  SERPRO_TETO_DIARIO_EMPRESA: "2", SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA: "0",
  SERPRO_TETO_MENSAL_MINIMO: "3", SERPRO_TETO_MENSAL_ABSOLUTO: "3",
});
const { autorizarChamada, concluirChamada, consumoDoMes } = await import("../src/application/fiscal/serpro/SerproCallGuard.js");
const { comContextoSerpro } = await import("../src/application/fiscal/serpro/serproCallContext.js");
const { prisma: singleton } = await import("../src/infrastructure/db/prisma.js");
const client = new PrismaClient({ datasources: { db: { url: url.href } } });
const origem = `test:serpro:${randomUUID()}`;
let checks = 0;
const ok = (name) => console.log(`OK ${++checks}: ${name}`);
const input = (cnpj, operacao) => ({ rota: "/Consultar", payload: { contribuinte: { numero: cnpj }, pedidoDados: { idSistema: "TEST", idServico: operacao }, fixture: origem } });
const reservar = (pedido, extra = {}) => comContextoSerpro({ origem, ...extra }, () => autorizarChamada(pedido, client));
const rejeitada = (pedido, code, extra) => assert.rejects(() => reservar(pedido, extra), (e) => e.code === code);
try {
  const [server] = await client.$queryRaw`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(server.db, "whatsapp_delivery_check");
  assert((server.host === "127.0.0.1" && server.port === 55439)
    || (process.env.CI === "true" && server.port === 5432 && /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(server.host)), "Servidor deve ser o cluster local ou serviço Docker do CI");
  // Tetos são globais: não misturar execução com outra suíte nem limpar registros alheios.
  assert.equal(await client.serproChamada.count(), 0, "Ledger de teste deve estar vazio antes do ensaio");
  const migrations = await client.$queryRaw`SELECT count(*)::int AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert(migrations[0].total >= 156, "Migrations devem estar aplicadas");
  ok("banco descartável validado e ledger vazio");

  const mesma = input("00000000000001", "MESMA");
  const concorrentes = await Promise.allSettled(Array.from({ length: 12 }, () => reservar(mesma)));
  const permitidas = concorrentes.filter((r) => r.status === "fulfilled");
  assert.equal(permitidas.length, 1);
  assert(concorrentes.filter((r) => r.status === "rejected").every((r) => r.reason.code === "SERPRO_CHAMADA_EM_ANDAMENTO"));
  assert.equal(await client.serproChamada.count({ where: { origem, status: "reservada" } }), 1);
  assert.equal(await client.serproChamada.count({ where: { origem, status: "recusada_cooldown" } }), 11);
  ok("12 transações reais concorrentes autorizam uma única assinatura e auditam 11 recusas");
  await concluirChamada(permitidas[0].value, { abortadaAuth: true, erroCodigo: "TEST_AUTH" }, client);
  assert.equal((await consumoDoMes(client)).usadas, 0);
  const retomada = await reservar(mesma);
  await concluirChamada(retomada, { httpStatus: 200 }, client);
  await rejeitada(mesma, "SERPRO_CHAMADA_REPETIDA");
  ok("auth abortada libera orçamento/assinatura; sucesso passa a cooldown");

  const ultimaDiaria = await Promise.allSettled([reservar(input("00000000000001", "DIARIA_A")), reservar(input("00000000000001", "DIARIA_B"))]);
  assert.equal(ultimaDiaria.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(ultimaDiaria.find((r) => r.status === "rejected").reason.code, "SERPRO_TETO_DIARIO");
  const reservaIncerta = ultimaDiaria.find((r) => r.status === "fulfilled").value;
  await concluirChamada(reservaIncerta, { erroCodigo: "SERPRO_TIMEOUT" }, client);
  const incerta = await client.serproChamada.findUnique({ where: { id: reservaIncerta.id } });
  assert.equal(incerta.status, "incerta");
  await rejeitada(input("00000000000001", incerta.idServico), "SERPRO_CHAMADA_EM_ANDAMENTO", { forcar: true, userId: "admin-teste" });
  assert.equal((await consumoDoMes(client)).incertas, 1);
  ok("última vaga diária não excedida; timeout permanece incerto e não aceita override");

  const ultimaMensal = await Promise.allSettled([reservar(input("00000000000002", "MENSAL_A")), reservar(input("00000000000003", "MENSAL_B"))]);
  assert.equal(ultimaMensal.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(ultimaMensal.find((r) => r.status === "rejected").reason.code, "SERPRO_TETO_MENSAL_ESCRITORIO");
  assert.equal((await consumoDoMes(client)).usadas, 3);
  ok("última vaga mensal disputada por CNPJs diferentes não excede teto global");
  const liberada = await reservar(input("00000000000004", "OVERRIDE"), { forcar: true, userId: "admin-teste" });
  const registro = await client.serproChamada.findUnique({ where: { id: liberada.id } });
  assert.equal(registro.forcado, true);
  assert.equal(registro.userId, "admin-teste");
  assert.equal(registro.origem, origem);
  await concluirChamada(liberada, { abortadaAuth: true }, client);
  assert.equal((await consumoDoMes(client)).usadas, 3);
  ok("override explícito do teto deixa identidade/origem; abortar antes do envio libera sua reserva");
  console.log(`PASS: ${checks} verificações SERPRO em PostgreSQL real, sem HTTP.`);
} finally {
  await client.serproChamada.deleteMany({ where: { origem } });
  await Promise.all([client.$disconnect(), singleton.$disconnect()]);
}
