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
const { autorizarChamada, autorizarDespacho, concluirChamada, consumoDoMes } = await import("../src/application/fiscal/serpro/SerproCallGuard.js");
const { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } = await import('../src/application/fiscal/serpro/CompanyAutomationService.js');
const { lerInssManual, listarInssManual, salvarInssManual } = await import('../src/application/operacoes/OperationsManualInss.js');
const { comContextoSerpro } = await import("../src/application/fiscal/serpro/serproCallContext.js");
const { guardarResposta, lerResposta, chaveResposta } = await import("../src/application/fiscal/serpro/SerproRespostaCache.js");
const { prisma: singleton } = await import("../src/infrastructure/db/prisma.js");
const client = new PrismaClient({ datasources: { db: { url: url.href } } });
const origem = `test:serpro:${randomUUID()}`;
const companies = Array.from({ length: 50 }, (_, i) => ({ id: randomUUID(), razao: `${origem} empresa ${i}`, cnpj: `99000000${String(i).padStart(6, '0')}` }));
const documento = { ...inputDocumento(), fixture: origem };
function inputDocumento() { return { contribuinte: { numero: "00000000000001" }, pedidoDados: { idServico: "GERARDAS12", dados: '{"periodoApuracao":"202608"}' } }; }
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
  const resposta = { status: 200, data: { dados: '{"pdf":"fixture"}' } };
  await Promise.all(Array.from({ length: 5 }, () => guardarResposta(documento, "/Emitir", resposta, client)));
  assert.equal(await client.serproRespostaCache.count({ where: { chave: chaveResposta(documento, "/Emitir") } }), 1);
  assert.deepEqual(await lerResposta(documento, "/Emitir", client), resposta.data);
  assert.equal(await lerResposta({ ...documento, contribuinte: { numero: "00000000000002" } }, "/Emitir", client), null);
  ok("cache documental persistido, upserts concorrentes únicos e isolamento por contribuinte");
  await client.serproRespostaCache.update({ where: { chave: chaveResposta(documento, "/Emitir") }, data: { expiraEm: new Date(Date.now() - 1000) } });
  assert.equal(await lerResposta(documento, "/Emitir", client), null);
  await guardarResposta(documento, "/Emitir", resposta, client);
  await comContextoSerpro({ atualizar: true }, async () => assert.equal(await lerResposta(documento, "/Emitir", client), null));
  assert.equal(await client.serproRespostaCache.count({ where: { chave: chaveResposta(documento, "/Emitir") } }), 0);
  ok("expiração e atualização explícita impedem reaproveitar documento antigo");
  await client.portalClient.createMany({ data: companies });
  for (const [i, company] of companies.entries()) {
    const current = await lerAutomacaoEmpresa(client, company.id);
    assert(current.rotinas.every(r => !r.enabled), 'Empresa nova não autoriza rotinas');
    if (i % 2 === 0) await salvarAutomacaoEmpresa(client, company.id, origem, {
      expectedRevision: current.revision, requestId: randomUUID(), serproPolicy: { paused: true, reason: 'Ensaio isolado' },
    }, { isAdmin: true });
  }
  for (const [i, company] of companies.entries()) {
    const pedido = input(company.cnpj, 'POLICY');
    if (i % 2 === 0) await rejeitada(pedido, 'SERPRO_EMPRESA_PAUSADA', { forcar: true, userId: origem });
    else {
      const auth = await reservar(pedido, { forcar: true, userId: origem });
      await autorizarDespacho(auth, client);
      await assert.rejects(() => autorizarDespacho(auth, client), e => e.code === 'SERPRO_CHAMADA_EM_ANDAMENTO');
      await concluirChamada(auth, { abortadaAuth: true }, client); // transporte simulado, nenhum HTTP
    }
  }
  assert.equal(await client.companyRotina.count({ where: { portalClientId: { in: companies.map(c => c.id) } } }), 0);
  assert.equal(await client.serproChamada.count({ where: { origem, status: 'recusada_politica' } }), 25);
  assert.equal((await consumoDoMes(client)).usadas, 3);
  ok('50 empresas: pausadas recusam até override, demais despacham uma vez sem habilitar rotinas');

  const company = companies[1];
  const before = await lerAutomacaoEmpresa(client, company.id);
  const reserved = await reservar(input(company.cnpj, 'PAUSE_DURING_AUTH'), { forcar: true, userId: origem });
  const paused = await salvarAutomacaoEmpresa(client, company.id, origem, {
    expectedRevision: before.revision, requestId: randomUUID(), serproPolicy: { paused: true, reason: 'Pausa entre reserva e despacho' },
  }, { isAdmin: true });
  await assert.rejects(() => autorizarDespacho(reserved, client), e => e.code === 'SERPRO_EMPRESA_PAUSADA');
  assert.equal((await client.serproChamada.findUnique({ where: { id: reserved.id } })).status, 'abortada_politica');
  assert.equal((await consumoDoMes(client)).usadas, 3);
  await salvarAutomacaoEmpresa(client, company.id, origem, { expectedRevision: paused.revision, requestId: randomUUID(), serproPolicy: { paused: false, reason: 'Retomada do ensaio' } }, { isAdmin: true });
  ok('pausa entre autenticação e transporte cancela reserva sem consumo; retomada não executa consulta');

  const raceReserve = await reservar(input(company.cnpj, 'RACE'), { forcar: true, userId: origem });
  const raceBefore = await lerAutomacaoEmpresa(client, company.id);
  const race = await Promise.allSettled([
    salvarAutomacaoEmpresa(client, company.id, origem, { expectedRevision: raceBefore.revision, requestId: randomUUID(), serproPolicy: { paused: true, reason: 'Disputa real pausa/despacho' } }, { isAdmin: true }),
    autorizarDespacho(raceReserve, client),
  ]);
  assert.equal(race[0].status, 'fulfilled');
  const dispatch = await client.appSetting.findUnique({ where: { key: `serpro_dispatch:${raceReserve.id}` } });
  const raced = await client.serproChamada.findUnique({ where: { id: raceReserve.id } });
  if (race[1].status === 'fulfilled') {
    assert(dispatch); assert.equal(raced.status, 'reservada');
    await concluirChamada(raceReserve, { erroCodigo: 'SIMULATED_UNKNOWN' }, client);
    await assert.rejects(() => autorizarDespacho(raceReserve, client), e => e.code === 'SERPRO_REGISTRO_INDETERMINADO');
  } else {
    assert.equal(race[1].reason.code, 'SERPRO_EMPRESA_PAUSADA');
    assert.equal(dispatch, null); assert.equal(raced.status, 'abortada_politica');
  }
  ok('concorrência PostgreSQL pausa/despacho produz ordem única e preserva reserva incerta');
  const comp = '2026-09';
  await client.portalClient.update({ where: { id: company.id }, data: { hasProlabore: true } });
  const initialInss = await lerInssManual(client, company.id, comp);
  assert.equal(initialInss.status, 'PENDING_DOCUMENT');
  const inssInput = { expectedRevision: initialInss.revision, requestId: randomUUID(), state: { ...initialInss.state, responsible: 'Responsável do ensaio', dueDate: '2026-10-19' } };
  const inssRace = await Promise.allSettled([
    salvarInssManual(client, company.id, comp, origem, inssInput, { isAdmin: true }),
    salvarInssManual(client, company.id, comp, origem, { ...inssInput, requestId: randomUUID(), state: { ...inssInput.state, responsible: 'Outro responsável' } }, { isAdmin: true }),
  ]);
  assert.equal(inssRace.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(inssRace.filter(r => r.status === 'rejected').length, 1);
  const guide = await client.guide.create({ data: { portalClientId: company.id, competencia: comp, tipo: 'INSS', status: 'PROCESSED', source: 'LOCAL', pdfBytes: Buffer.from('%PDF-1.4 fixture'), valor: '100.00', sourceFileId: `${origem}:inss` } });
  assert.equal((await lerInssManual(client, company.id, comp)).status, 'DOCUMENT_AVAILABLE');
  assert.equal((await lerInssManual(client, company.id, '2026-10')).status, 'PENDING_DOCUMENT');
  const savedGuide = await client.guide.findUnique({ where: { id: guide.id } });
  assert.equal(savedGuide.paymentStatus, 'OPEN');
  const scoped = await listarInssManual(client, [companies[0].id], comp);
  assert.equal(scoped.items.length, 1); assert.equal(scoped.items[0].guides.length, 0);
  const inssCurrent = await lerInssManual(client, company.id, comp);
  const retryInput = { expectedRevision: inssCurrent.revision, requestId: randomUUID(), state: { ...inssCurrent.state, note: 'Conferência local' } };
  const firstSave = await salvarInssManual(client, company.id, comp, origem, retryInput, { isAdmin: true });
  assert.deepEqual(await salvarInssManual(client, company.id, comp, origem, retryInput, { isAdmin: true }), firstSave);
  ok('INSS manual: disputa preserva revisão, upload local satisfaz documento, replay único e isolamento por competência/empresa');
  console.log(`PASS: ${checks} verificações SERPRO em PostgreSQL real, sem HTTP.`);
} finally {
  const reservations = await client.serproChamada.findMany({ where: { origem }, select: { id: true } });
  await client.appSetting.deleteMany({ where: { OR: [
    { key: { in: companies.map(c => `company_serpro_policy:${c.id}`) } },
    { key: { startsWith: `company_automation_request:${origem}:` } },
    { key: { startsWith: `operations_manual_inss_request:${origem}:` } },
    { key: { in: companies.map(c => `operations_manual_inss:v1:${c.id}:2026-09`) } },
    { key: { in: reservations.map(r => `serpro_dispatch:${r.id}`) } },
  ] } });
  await client.serproRespostaCache.deleteMany({ where: { chave: chaveResposta(documento, "/Emitir") } });
  await client.serproChamada.deleteMany({ where: { origem } });
  await client.guide.deleteMany({ where: { sourceFileId: `${origem}:inss` } });
  await client.portalClient.deleteMany({ where: { id: { in: companies.map(c => c.id) } } });
  await Promise.all([client.$disconnect(), singleton.$disconnect()]);
}
