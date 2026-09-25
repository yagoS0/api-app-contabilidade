// PostgreSQL real + parser/serviço reais, transporte e credencial inteiramente sintéticos.
// Não carrega .env. Execute com o Prisma gerado para este schema e --url local abaixo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, syncBuiltinESMExports } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import http from "node:http";
import https from "node:https";

const index = process.argv.indexOf("--url");
const url = new URL(index >= 0 ? process.argv[index + 1] : process.env.DATABASE_URL || "invalid:");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55447"
    || url.pathname !== "/consulta_pagamento_check" || url.username !== "consulta_test") {
  throw Error("Use somente consulta_pagamento_check, consulta_test, 127.0.0.1:55447.");
}
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = "test";
const noHttp = () => { throw Error("HTTP/IA proibidos neste ensaio."); };
globalThis.fetch = noHttp;
http.request = http.get = https.request = https.get = noHttp;
syncBuiltinESMExports();
register("./test-support/parcela-postgres-loader.js", import.meta.url);
const { PrismaClient } = await import("@prisma/client");
const { prisma: singleton } = await import("../src/infrastructure/db/prisma.js");
const { confirmarPagamentoParcela } = await import("../src/application/fiscal/serpro/SerproParcelaPagamentoService.js");
const { registrarConsultaPagamentoGuia } = await import("../src/application/guides/ConsultaPagamentoGuiaService.js");
const { claimScheduledRun, finishScheduledRun } = await import("../src/workers/scheduledRoutineService.js");
const { localCalendar } = await import("../src/workers/routineSchedule.js");
const a = new PrismaClient({ datasources: { db: { url: url.href } } });
const b = new PrismaClient({ datasources: { db: { url: url.href } } });
const prefix = `parcela-pg-${randomUUID()}`;
const companyId = `${prefix}-company`;
const guideIds = [], parcelaIds = [], contractIds = [], scheduleKeys = [];
const failureTriggers = [];
const cnpj = "00000000000001";
const realDateNow = Date.now;
let checks = 0, calls = 0;
const ok = title => console.log(`OK ${++checks}: ${title}`);
const validRaw = { status: 200, contribuinte: { numero: cnpj, tipo: 2 }, dados: { numeroParcelamento: 123, paDasGerado: 202609, numeroParcela: 3,
  dataPagamento: 20260920, valorPagoArrecadacao: 100,
  pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 100, juros: 0, multa: 0, total: 100 }] }] } };
let transport = async () => ({ raw: structuredClone(validRaw) });
globalThis[Symbol.for("altan.parcela-postgres-fixture")] = async input => {
  calls++;
  assert.equal(input.contribuinteCnpj, cnpj);
  assert.equal(input.contratanteCnpj, "11111111000191");
  assert.equal(input.tipo, "PARCSN");
  assert.equal(input.anoMesParcela, 202609);
  assert.equal(input.numeroParcelamento, 123);
  return transport(input);
};
async function fixture() {
  const n = guideIds.length, guideId = `${prefix}-g${n}`, parcelaId = `${prefix}-p${n}`, contractId = `${prefix}-c${n}`;
  guideIds.push(guideId); parcelaIds.push(parcelaId); contractIds.push(contractId);
  // Contrato único por empresa/tipo/número: liberar número do caso anterior após concluído.
  await a.parcelamento.updateMany({ where: { id: { in: contractIds.slice(0, -1) } }, data: { numeroParcelamento: null } });
  await a.parcelamento.create({ data: { id: contractId, portalClientId: companyId, label: "Contrato sintético", kind: "SIMPLES", tipo: "PARCSN", numeroParcelamento: "123" } });
  await a.guide.create({ data: { id: guideId, portalClientId: companyId, cnpj, tipo: "SIMPLES", competencia: "2026-09",
    valor: 100, status: "PROCESSED", source: "SERPRO", hash: `${guideId}-v1`, extracted: { principal: 100 },
    parcelamentoId: contractId, numeroParcela: 3, anoMesParcela: "202609" } });
  await a.parcela.create({ data: { id: parcelaId, portalClientId: companyId, parcelamentoId: contractId,
    numeroParcela: 3, competencia: "2026-09", anoMesParcela: "202609", valorPrevisto: 100, guiaId: guideId } });
  transport = async () => ({ raw: structuredClone(validRaw) });
  return { guideId, parcelaId, contractId };
}
const query = (f, extra = {}) => confirmarPagamentoParcela({ portalClientId: companyId, parcelaId: f.parcelaId, ...extra });
const read = async f => ({
  guide: await a.guide.findUnique({ where: { id: f.guideId } }),
  parcela: await a.parcela.findUnique({ where: { id: f.parcelaId } }),
  observations: await a.guidePaymentObservation.findMany({ where: { guideReferenceId: f.guideId } }),
});
async function untouched(f) {
  const state = await read(f);
  assert.equal(state.guide.paymentStatus, "OPEN");
  assert.equal(state.parcela.pagamentoStatus, null);
  assert.equal(state.parcela.pagamentoEm, null);
  assert.equal(state.observations.length, 0);
  return state;
}
async function mutationDuringHttp(f, mutation) {
  transport = async () => { await mutation(b); return { raw: structuredClone(validRaw) }; };
  return query(f);
}
// A transação concorrente já segura a linha quando a resposta chega. Verifica no
// PostgreSQL que a consulta realmente espera o lock, sem temporização por adivinhação.
async function withRealLock(f, table, mutation) {
  let entered, release;
  const locked = new Promise(r => { entered = r; });
  const released = new Promise(r => { release = r; });
  const holder = b.$transaction(async tx => {
    if (table === "Guide") await tx.$queryRaw`SELECT "id" FROM "Guide" WHERE "id" = ${f.guideId} FOR UPDATE`;
    else if (table === "PortalClient") await tx.$queryRaw`SELECT "id" FROM "PortalClient" WHERE "id" = ${companyId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "parcelamentos" WHERE "id" = ${f.contractId} FOR UPDATE`;
    entered(); await released; await mutation(tx);
  }, { timeout: 15000 });
  await Promise.race([holder, locked]);
  const pending = query(f);
  let result;
  try {
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      const rows = await a.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND application_name = '' AND query LIKE 'SELECT "id" FROM %'`;
      waiting = rows[0].n > 0;
      if (!waiting) await delay(20);
    }
    assert(waiting, `consulta deve aguardar lock real de ${table}`);
  } finally { release(); }
  [, result] = await Promise.all([holder, pending]);
  return result;
}

try {
  const [db] = await a.$queryRaw`SELECT current_database() AS db, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(db.db, "consulta_pagamento_check");
  assert.equal(db.role, "consulta_test");
  // O Actions encaminha a URL local validada (55447) para o PostgreSQL do container.
  if (process.env.GITHUB_ACTIONS === "true") assert.equal(db.port, 5432);
  else {
    assert.equal(db.host, "127.0.0.1");
    assert.equal(db.port, 55447);
  }
  await a.portalClient.create({ data: { id: companyId, cnpj, razao: "Empresa sintética — ensaio de parcelas" } });
  const accountingBefore = await a.accountingEntry.count();
  ok("banco local confirmado; bloqueio de HTTP e transporte simulado carregados");

  const normal = await fixture();
  const success = await query(normal);
  assert.equal(success.pago, true);
  assert.equal(success.aplicadaGuia, true);
  const saved = await read(normal);
  assert.equal(saved.guide.paymentStatus, "PAID");
  assert.equal(saved.guide.paymentStatusSource, "SERPRO");
  assert.equal(saved.guide.baixada, false);
  assert.equal(saved.parcela.pagamentoStatus, "CONFIRMADO");
  assert.equal(saved.parcela.origemBaixa, null);
  assert.equal(saved.parcela.baixadaEm, null);
  assert.equal(Number(saved.parcela.valorPago), 100);
  assert.equal(saved.parcela.pagamentoEm.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(saved.observations.length, 1);
  assert.equal(saved.observations[0].state, "CONFIRMADO");
  assert.equal(saved.observations[0].applied, true);
  assert.equal(saved.guide.extracted.consultaPagamento.observacaoId, saved.observations[0].id);
  ok("confirmação real grava Guia + Parcela + observação coerentes, sem baixa contábil");

  const withoutGuide = await fixture();
  await a.parcela.update({ where: { id: withoutGuide.parcelaId }, data: { guiaId: null } });
  const noGuideResult = await query(withoutGuide);
  const noGuideState = await read(withoutGuide);
  assert.equal(noGuideResult.pago, true);
  assert.equal(noGuideState.parcela.pagamentoStatus, "CONFIRMADO");
  assert.equal(Number(noGuideState.parcela.valorPago), 100);
  assert.equal(noGuideState.parcela.origemBaixa, null);
  assert.equal(noGuideState.guide.paymentStatus, "OPEN");
  assert.equal(noGuideState.observations.length, 0);
  ok("parcela sem guia usa valorPrevisto Prisma.Decimal real sem relaxar parser monetário");

  const lostAfterHttp = await fixture();
  let active = true;
  transport = async () => { active = false; return { raw: structuredClone(validRaw) }; };
  await assert.rejects(query(lostAfterHttp, { assertActive: () => { if (!active) throw Error("LEASE_LOST_TEST"); } }), /LEASE_LOST_TEST/);
  const reserved = await untouched(lostAfterHttp);
  assert(reserved.parcela.pagamentoConsultadoEm, "reserva de custo anterior ao HTTP permanece");
  ok("lease perdida após HTTP não persiste pagamento ou observação");

  const rollback = await fixture();
  // Falha real no último write: Guia + observação já foram escritas na transação.
  // AFTER UPDATE também executa após a alteração da Parcela, antes do commit.
  // Não mocka Prisma e só afeta este ID sintético.
  const triggerName = `parcela_fail_${randomUUID().replace(/-/g, "")}`;
  assert(/^[a-z0-9_]+$/.test(triggerName) && /^[a-z0-9-]+$/.test(rollback.parcelaId));
  failureTriggers.push(triggerName);
  await a.$executeRawUnsafe(`CREATE FUNCTION "${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."id" = '${rollback.parcelaId}' AND NEW."pagamentoStatus" = 'CONFIRMADO' THEN
      RAISE EXCEPTION 'PARCELA_TEST_WRITE_FAILURE'; END IF; RETURN NEW; END; $$`);
  await a.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" AFTER UPDATE ON "parcelas"
    FOR EACH ROW EXECUTE FUNCTION "${triggerName}"()`);
  try {
    await assert.rejects(query(rollback), /PARCELA_TEST_WRITE_FAILURE/);
    await untouched(rollback);
  } finally {
    await a.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "parcelas"`);
    await a.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerName}"()`);
    failureTriggers.splice(failureTriggers.indexOf(triggerName), 1);
  }
  ok("falha real no write da Parcela reverte Guia + Parcela + observação já escritas");

  const recalculated = await fixture();
  assert.equal((await mutationDuringHttp(recalculated, db => db.guide.update({ where: { id: recalculated.guideId }, data: { hash: "documento-recalculado", valor: 110 } }))).motivo, "REFERENCIA_ALTERADA");
  await untouched(recalculated);
  ok("recálculo durante HTTP invalida documento anterior antes de confirmar");

  const contract = await fixture();
  assert.equal((await mutationDuringHttp(contract, db => db.parcelamento.update({ where: { id: contract.contractId }, data: { numeroParcelamento: "456" } }))).motivo, "REFERENCIA_ALTERADA");
  await untouched(contract);
  ok("alteração de contrato durante HTTP impede aplicar resposta antiga");

  const company = await fixture();
  assert.equal((await mutationDuringHttp(company, db => db.portalClient.update({ where: { id: companyId }, data: { cnpj: "00000000000002" } }))).motivo, "EMPRESA_ALTERADA");
  await untouched(company);
  await a.portalClient.update({ where: { id: companyId }, data: { cnpj } });
  ok("alteração de CNPJ durante HTTP impede confirmar outra empresa");

  const lockedCompany = await fixture();
  assert.equal((await withRealLock(lockedCompany, "PortalClient", tx => tx.portalClient.update({ where: { id: companyId }, data: { cnpj: "00000000000002" } }))).motivo, "EMPRESA_ALTERADA");
  await untouched(lockedCompany);
  await a.portalClient.update({ where: { id: companyId }, data: { cnpj } });
  ok("lock real da empresa espera alteração concorrente e revalida CNPJ");

  const lockedContract = await fixture();
  assert.equal((await withRealLock(lockedContract, "parcelamentos", tx => tx.parcelamento.update({ where: { id: lockedContract.contractId }, data: { status: "EXCLUIDO" } }))).motivo, "REFERENCIA_ALTERADA");
  await untouched(lockedContract);
  ok("lock real do contrato espera alteração concorrente e revalida exclusão");

  const manual = await fixture();
  const manualDate = new Date("2026-09-21T00:00:00Z");
  const rejectedManual = await withRealLock(manual, "Guide", async tx => {
    await tx.guide.update({ where: { id: manual.guideId }, data: { paymentStatus: "PAID", paymentStatusSource: "MANUAL", baixada: true,
      paymentConfirmedAt: manualDate, paymentConfirmedByUserId: "contador-sintetico", extracted: { principal: 100, comprovante: { principal: 90, confiavel: true } } } });
    await tx.parcela.update({ where: { id: manual.parcelaId }, data: { origemBaixa: "MANUAL", baixadaEm: manualDate } });
  });
  assert.equal(rejectedManual.motivo, "PAGAMENTO_JA_REGISTRADO");
  const kept = await read(manual);
  assert.equal(kept.guide.paymentStatusSource, "MANUAL");
  assert.equal(kept.guide.paymentConfirmedByUserId, "contador-sintetico");
  assert.deepEqual(kept.guide.paymentConfirmedAt, manualDate);
  assert.equal(kept.guide.extracted.comprovante.principal, 90);
  assert.equal(kept.parcela.origemBaixa, "MANUAL");
  assert.deepEqual(kept.parcela.baixadaEm, manualDate);
  assert.equal(kept.observations.length, 0);
  ok("baixa manual concorrente com lock real preserva autoria, data e composição, sem deadlock");

  const duplicate = await fixture();
  const beforeDuplicate = calls;
  let entered, release;
  const pendingHttp = new Promise(r => { entered = r; });
  const allowHttp = new Promise(r => { release = r; });
  transport = async () => { entered(); await allowHttp; return { raw: structuredClone(validRaw) }; };
  const first = query(duplicate);
  await pendingHttp;
  const second = await query(duplicate);
  release();
  assert.equal((await first).pago, true);
  assert(["intervalo_minimo", "consulta_em_andamento"].includes(second.skipped));
  assert.equal(calls - beforeDuplicate, 1);
  assert.equal((await read(duplicate)).observations.length, 1);
  ok("duas consultas concorrentes compartilham reserva persistente: uma chamada e uma observação");

  const ownership = await fixture();
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  Date.now = () => +now;
  const config = { enabled: true, frequency: "DAILY", hour: localCalendar(now).hour };
  const firstOwner = await claimScheduledRun({ routine: `${prefix}-owner`, config, now, db: a });
  assert(firstOwner, "reserva sintética é criada somente no minuto configurado");
  scheduleKeys.push(firstOwner.key);
  let nextOwner;
  const assertOwner = async () => {
    const state = await a.appSetting.findUnique({ where: { key: firstOwner.key } });
    if (state.value.owner !== firstOwner.value.owner) throw Error("OWNER_CHANGED_TEST");
  };
  transport = async () => {
    const repeat = await claimScheduledRun({ routine: `${prefix}-owner`, config, now: new Date(+now + 6 * 60000), db: b });
    assert.equal(repeat, null, "reserva expirada não autoriza repetir consulta automática");
    // Troca exclusiva desta fixture testa o proprietário sem reintroduzir retry na agenda.
    nextOwner = { key: firstOwner.key, value: { ...firstOwner.value, owner: randomUUID() } };
    await b.appSetting.update({ where: { key: nextOwner.key }, data: { value: nextOwner.value } });
    assert.notEqual(nextOwner.value.owner, firstOwner.value.owner);
    return { raw: structuredClone(validRaw) };
  };
  await assert.rejects(query(ownership, { assertActive: assertOwner }), /OWNER_CHANGED_TEST/);
  await untouched(ownership);
  assert.equal(await finishScheduledRun(firstOwner, {}, null, { db: a }), false);
  // Reserva de custo continua bloqueando nova tentativa imediata, mesmo para novo executor.
  const costBefore = calls;
  assert.equal((await query(ownership)).skipped, "intervalo_minimo");
  assert.equal(calls, costBefore);
  // Simula exclusivamente o decurso do intervalo nesta linha sintética.
  await a.parcela.update({ where: { id: ownership.parcelaId }, data: { pagamentoConsultadoEm: new Date(Date.now() - 86_401_000) } });
  transport = async () => ({ raw: structuredClone(validRaw) });
  assert.equal((await query(ownership, { assertActive: async () => {
    const state = await a.appSetting.findUnique({ where: { key: nextOwner.key } });
    assert.equal(state.value.owner, nextOwner.value.owner);
  } })).pago, true);
  assert.equal(await finishScheduledRun(nextOwner, {}, null, { db: b }), true);
  assert.equal((await read(ownership)).observations.length, 1);
  Date.now = realDateNow;
  ok("reserva não repete automaticamente; troca sintética de proprietário preserva custo e permite conferência manual após intervalo");

  for (const confirmed of [true, false]) {
    const declared = await fixture();
    const declaredAt = new Date("2026-09-21T10:00:00Z"), informedPayment = new Date("2026-09-19T00:00:00Z");
    await a.guide.update({ where: { id: declared.guideId }, data: {
      paymentStatus: "PAID", paymentStatusSource: "CLIENTE", paymentConfirmedAt: informedPayment,
      paymentConfirmedByUserId: "cliente-sintetico", clienteConfirmouEm: declaredAt, clienteConfirmouPorUserId: "cliente-sintetico",
    } });
    if (!confirmed) transport = async () => ({ raw: { ...validRaw, dados: {
      ...validRaw.dados, dataPagamento: null, valorPagoArrecadacao: null, pagamentoDebitos: [],
    } } });
    const result = await query(declared);
    const current = await read(declared);
    assert.equal(result.pago, confirmed);
    assert.equal(current.guide.paymentStatus, "PAID");
    assert.deepEqual(current.guide.clienteConfirmouEm, declaredAt);
    assert.equal(current.guide.clienteConfirmouPorUserId, "cliente-sintetico");
    assert.equal(current.observations.length, 1);
    if (confirmed) {
      assert.equal(current.guide.paymentStatusSource, "SERPRO");
      assert.equal(current.guide.extracted.pagamentoDeclaradoCliente.pagoEmInformado, informedPayment.toISOString());
      assert.equal(current.guide.extracted.pagamentoDeclaradoCliente.porUserId, "cliente-sintetico");
      assert.equal(current.parcela.pagamentoStatus, "CONFIRMADO");
      assert.equal(current.guide.paymentConfirmedAt.toISOString(), "2026-09-20T00:00:00.000Z");
    } else {
      assert.equal(current.guide.paymentStatusSource, "CLIENTE");
      assert.equal(current.guide.paymentConfirmedByUserId, "cliente-sintetico");
      assert.deepEqual(current.guide.paymentConfirmedAt, informedPayment);
      assert.equal(current.parcela.pagamentoStatus, "NAO_LOCALIZADO");
    }
    ok(confirmed ? "pagamento declarado pelo cliente recebe evidência oficial preservando histórico" : "resposta negativa conserva pagamento declarado, autoria e data do cliente");
  }

  const superseded = await fixture();
  transport = async () => {
    const guide = await b.guide.findUnique({ where: { id: superseded.guideId } });
    await registrarConsultaPagamentoGuia({ guide, client: b, resultadoConsulta: {
      estado: "INDETERMINADO", fonte: "PAGTOWEB", consultadoEm: new Date(Date.now() + 1000).toISOString(),
      numeroDocumento: null, cobertura: "PARCIAL", identidadeConferida: false, motivo: "CONSULTA_MAIS_RECENTE",
    } });
    return { raw: structuredClone(validRaw) };
  };
  const outdated = await query(superseded);
  const lastState = await read(superseded);
  assert.equal(outdated.aplicada, false, "recusa da observação da guia não pode deixar parcela confirmada");
  assert.equal(outdated.pago, null);
  assert.equal(lastState.parcela.pagamentoStatus, null);
  assert.equal(lastState.parcela.pagamentoEm, null);
  assert.equal(lastState.guide.paymentStatus, "OPEN");
  assert.equal(lastState.guide.extracted.consultaPagamento.motivo, "CONSULTA_MAIS_RECENTE");
  ok("observação de guia mais recente recusa também confirmação antiga da parcela");
  assert(lastState.parcela.pagamentoConsultadoEm, "tentativa consumida mantém o instante real para controle de custo");
  const callsBeforeRetry = calls;
  assert.equal((await query(superseded)).skipped, "intervalo_minimo");
  assert.equal(calls, callsBeforeRetry);
  ok("consulta recusada por observação mais recente conserva cooldown e não repete transporte");

  assert.equal(await a.accountingEntry.count(), accountingBefore);
  ok("nenhum lançamento contábil criado ou removido em todos os cenários");
  console.log(`PASS: ${checks} verificações PostgreSQL reais; ${calls} chamadas sintéticas; zero HTTP/IA/credenciais reais.`);
} finally {
  Date.now = realDateNow;
  delete globalThis[Symbol.for("altan.parcela-postgres-fixture")];
  for (const name of failureTriggers) {
    await a.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "parcelas"`);
    await a.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
  }
  await a.guidePaymentObservation.deleteMany({ where: { guideReferenceId: { in: guideIds } } });
  await a.parcela.deleteMany({ where: { id: { in: parcelaIds } } });
  await a.guide.deleteMany({ where: { id: { in: guideIds } } });
  await a.parcelamento.deleteMany({ where: { id: { in: contractIds } } });
  await a.portalClient.deleteMany({ where: { id: companyId } });
  await a.appSetting.deleteMany({ where: { key: { in: scheduleKeys } } });
  await Promise.all([a, b, singleton].map(client => client.$disconnect()));
}
