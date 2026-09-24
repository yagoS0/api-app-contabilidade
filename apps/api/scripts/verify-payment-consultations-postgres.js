// Ensaio sintético, sem .env/HTTP. Aplicar migrations antes; nunca apontar para produção.
// node scripts/verify-payment-consultations-postgres.js --url postgresql://consulta_test@127.0.0.1:55447/consulta_pagamento_check
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { PrismaClient } from "@prisma/client";

const arg = process.argv.indexOf("--url");
const url = new URL(arg >= 0 ? process.argv[arg + 1] : process.env.DATABASE_URL || "invalid:");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55447"
    || url.pathname !== "/consulta_pagamento_check" || url.username !== "consulta_test") {
  throw new Error("Use somente consulta_pagamento_check, consulta_test, 127.0.0.1:55447.");
}
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = "test";
const noHttp = () => { throw new Error("HTTP proibido neste ensaio"); };
globalThis.fetch = http.request = http.get = https.request = https.get = noHttp;
syncBuiltinESMExports();
const { registrarConsultaPagamentoGuia } = await import("../src/application/guides/ConsultaPagamentoGuiaService.js");
const { createOrUpdateGuideFromProcessing } = await import("../src/application/guides/GuideService.js");
const { prisma: singleton } = await import("../src/infrastructure/db/prisma.js");
const { claimScheduledRun, finishScheduledRun, runScheduledRoutine } = await import("../src/workers/scheduledRoutineService.js");
const { localCalendar, describeSchedule } = await import("../src/workers/routineSchedule.js");
const clients = Array.from({ length: 2 }, () => new PrismaClient({ datasources: { db: { url: url.href } } }));
const [a, b] = clients;
const prefix = `payment-test-${randomUUID()}`;
const companyId = `${prefix}-company`;
const guideIds = [];
const scheduleKeys = [];
const realDateNow = Date.now;
let checks = 0;
const ok = title => console.log(`OK ${++checks}: ${title}`);
const evidence = (estado = "CONFIRMADO", extra = {}) => ({
  consultaId: randomUUID(), estado, fonte: "PGDASD_CONSDECLARACAO13",
  consultadoEm: "2026-09-25T11:00:00.000Z", numeroDocumento: "12345678901234567",
  cobertura: "COMPLETA", identidadeConferida: true, ...extra,
});
async function guide(extra = {}) {
  const id = `${prefix}-${guideIds.length}`;
  guideIds.push(id);
  return a.guide.create({ data: { id, portalClientId: companyId, cnpj: "00000000000001",
    tipo: "SIMPLES", competencia: "2026-08", valor: 100, status: "PROCESSED", source: "SERPRO",
    hash: `${id}-v1`, extracted: { numeroDocumento: "12345678901234567" }, ...extra },
  include: { portalClient: { select: { cnpj: true } } } });
}
const read = id => a.guide.findUnique({ where: { id } });
const save = (g, r, extra = {}) => registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: r, client: b, ...extra });

// Segura um lock real até que outra conexão tenha tentado persistir a consulta.
async function duringWrite(g, mutation) {
  let signalLocked, releaseLock;
  const locked = new Promise(resolve => { signalLocked = resolve; });
  const released = new Promise(resolve => { releaseLock = resolve; });
  const holder = a.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Guide" WHERE "id" = ${g.id} FOR UPDATE`;
    signalLocked();
    await released;
    await mutation(tx);
  }, { timeout: 15000 });
  // Propaga falha de aquisição sem deixar o ensaio pendurado.
  await Promise.race([locked, holder]);
  const pending = save(g, evidence());
  try {
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      const rows = await singleton.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Guide%FOR UPDATE%'`;
      waiting = rows[0].n > 0;
      if (!waiting) await delay(20);
    }
    assert(waiting, "segunda conexão deve aguardar o lock real da guia");
  } finally { releaseLock(); }
  const [, result] = await Promise.all([holder, pending]);
  return result;
}

try {
  const [server] = await a.$queryRaw`SELECT current_database() AS db, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(server.db, "consulta_pagamento_check");
  assert.equal(server.role, "consulta_test");
  // No Actions, a URL local 55447 (validada acima) é encaminhada ao container 5432.
  // inet_server_addr/port descrevem o backend, não o endereço usado pelo cliente.
  if (process.env.GITHUB_ACTIONS === "true") assert.equal(server.port, 5432);
  else {
    assert.equal(server.host, "127.0.0.1");
    assert.equal(server.port, 55447);
  }
  const migration = await a.$queryRaw`SELECT migration_name FROM _prisma_migrations
    WHERE migration_name = '20260924210000_guide_payment_observations' AND finished_at IS NOT NULL`;
  assert.equal(migration.length, 1);
  await a.portalClient.create({ data: { id: companyId, razao: "Empresa sintética — consulta", cnpj: "00000000000001" } });
  const accountingBefore = await a.accountingEntry.count();
  ok("banco local e migration da observação confirmados");

  const same = await guide();
  const shared = evidence();
  const parallel = await Promise.all(Array.from({ length: 12 }, (_, index) => save(same, shared, { client: clients[index % 2] })));
  assert.equal(parallel.filter(r => !r.repetida).length, 1);
  assert.equal(await a.guidePaymentObservation.count({ where: { guideReferenceId: same.id } }), 1);
  assert.equal(new Set(parallel.map(r => r.resultadoConsulta.observacaoId)).size, 1);
  assert.equal((await read(same.id)).paymentStatus, "PAID");
  assert.equal((await read(same.id)).paymentConfirmedAt, null);
  ok("12 persistências concorrentes: uma observação e nenhuma data de pagamento inventada");

  const old = await save(same, evidence("NAO_LOCALIZADO", { consultadoEm: "2026-09-25T10:00:00Z" }));
  assert.equal(old.motivoNaoAplicada, "OBSERVACAO_SUPERADA");
  assert.equal((await read(same.id)).extracted.consultaPagamento.estado, "CONFIRMADO");
  assert.equal(await a.guidePaymentObservation.count({ where: { guideReferenceId: same.id } }), 2);
  ok("negativa atrasada auditada, sem sobrescrever confirmação recente");

  const changed = await guide();
  const stale = await duringWrite(changed, tx => tx.guide.update({ where: { id: changed.id }, data: { hash: `${changed.id}-v2`, valor: 110 } }));
  assert.equal(stale.motivoNaoAplicada, "DOCUMENTO_ALTERADO");
  assert.equal((await read(changed.id)).paymentStatus, "OPEN");
  assert.equal((await read(changed.id)).serproLastCheckedAt, null);
  ok("recálculo concorrente protegido por lock: documento novo permanece aberto");

  const manual = await guide();
  const manualDate = new Date("2026-09-21T00:00:00Z");
  await duringWrite(manual, tx => tx.guide.update({ where: { id: manual.id }, data: {
    paymentStatus: "PAID", paymentStatusSource: "MANUAL", baixada: true,
    paymentConfirmedByUserId: "contador-sintetico", paymentConfirmedAt: manualDate,
    extracted: { ...manual.extracted, comprovante: { principal: 95, confiavel: true } },
  } }));
  const kept = await read(manual.id);
  assert.equal(kept.paymentStatusSource, "MANUAL");
  assert.equal(kept.paymentConfirmedByUserId, "contador-sintetico");
  assert.deepEqual(kept.paymentConfirmedAt, manualDate);
  assert.equal(kept.extracted.comprovante.principal, 95);
  ok("baixa manual concorrente preserva autor, data e composição");

  const declared = await guide({ paymentStatus: "PAID", paymentStatusSource: "CLIENTE",
    clienteConfirmouEm: manualDate, clienteConfirmouPorUserId: "cliente-sintetico", paymentConfirmedAt: manualDate });
  await save(declared, evidence());
  const promoted = await read(declared.id);
  assert.equal(promoted.paymentStatusSource, "SERPRO");
  assert.equal(promoted.clienteConfirmouPorUserId, "cliente-sintetico");
  assert.deepEqual(promoted.clienteConfirmouEm, manualDate);
  assert.equal(promoted.extracted.pagamentoDeclaradoCliente.pagoEmInformado, manualDate.toISOString());
  assert.equal(promoted.paymentConfirmedAt, null);
  ok("confirmação oficial preserva declaração do cliente em campos próprios");

  for (const estado of ["NAO_LOCALIZADO", "INDETERMINADO", "PARCIAL_OU_DIVERGENTE", "NAO_APLICAVEL"]) {
    const g = await guide();
    await save(g, evidence(estado));
    const current = await read(g.id);
    assert.equal(current.paymentStatus, "OPEN");
    assert.equal(current.extracted.consultaPagamento.estado, estado);
  }
  ok("quatro resultados não positivos conservam estado financeiro e registram evidência");

  const invalidIdentity = await guide();
  await save(invalidIdentity, evidence("CONFIRMADO", { identidadeConferida: false }));
  assert.equal((await read(invalidIdentity.id)).paymentStatus, "OPEN");
  assert.equal((await read(invalidIdentity.id)).extracted.consultaPagamento.estado, "INDETERMINADO");
  ok("confirmação sem identidade suficiente não marca pagamento");

  const changedCompany = await guide();
  await a.portalClient.update({ where: { id: companyId }, data: { cnpj: "00000000000002" } });
  assert.equal((await save(changedCompany, evidence())).motivoNaoAplicada, "EMPRESA_ALTERADA");
  await a.portalClient.update({ where: { id: companyId }, data: { cnpj: "00000000000001" } });
  ok("resposta do CNPJ anterior recusada após mudança cadastral");

  const cancelled = await guide();
  let leaseCalls = 0;
  await assert.rejects(() => save(cancelled, evidence(), { assertActive: () => {
    if (++leaseCalls === 2) throw new Error("LEASE_TEST_PERDIDO");
  } }), /LEASE_TEST_PERDIDO/);
  assert.equal(await a.guidePaymentObservation.count({ where: { guideReferenceId: cancelled.id } }), 0);
  assert.equal((await read(cancelled.id)).paymentStatus, "OPEN");
  ok("perda de reserva dentro da transação faz rollback integral");

  const replayGuide = await guide();
  const replayEvidence = evidence();
  await save(replayGuide, replayEvidence);
  await a.guide.update({ where: { id: replayGuide.id }, data: { hash: `${replayGuide.id}-v2`, paymentStatus: "OPEN" } });
  const replay = await save(await read(replayGuide.id), replayEvidence);
  assert.equal(replay.aplicada, false);
  assert.equal(replay.motivoNaoAplicada, "DOCUMENTO_ALTERADO");
  assert.equal((await read(replayGuide.id)).paymentStatus, "OPEN");
  assert.equal(await a.guidePaymentObservation.count({ where: { guideReferenceId: replayGuide.id } }), 1);
  const foreignDocument = await guide();
  assert.equal((await save(foreignDocument, evidence("CONFIRMADO", { numeroDocumento: "76543210987654321" }))).motivoNaoAplicada, "IDENTIDADE_RESULTADO_DIVERGENTE");
  assert.equal((await read(foreignDocument.id)).paymentStatus, "OPEN");
  ok("replay após recálculo e observação de outro documento não confirmam guia");

  const recaptured = await guide();
  const checked = await save(recaptured, evidence("NAO_LOCALIZADO"));
  const captureInput = { existingGuideId: recaptured.id, portalClientId: companyId,
    parsed: { cnpj: recaptured.cnpj, tipo: recaptured.tipo, competencia: recaptured.competencia, valor: recaptured.valor },
    source: recaptured.source, status: recaptured.status, hash: recaptured.hash, extracted: recaptured.extracted };
  const sameCapture = await createOrUpdateGuideFromProcessing(captureInput);
  assert.deepEqual(sameCapture.extracted.consultaPagamento, checked.guia.extracted.consultaPagamento);
  assert.deepEqual(sameCapture.serproLastCheckedAt, checked.guia.serproLastCheckedAt);
  const olderAfterCapture = await save(sameCapture, evidence("CONFIRMADO", { consultadoEm: "2026-09-25T10:00:00.000Z" }));
  assert.equal(olderAfterCapture.motivoNaoAplicada, "OBSERVACAO_SUPERADA");
  const newCapture = await createOrUpdateGuideFromProcessing({ ...captureInput, hash: `${recaptured.id}-v2` });
  assert.equal(newCapture.extracted.consultaPagamento.estado, "INDETERMINADO");
  assert.equal(newCapture.extracted.consultaPagamento.motivo, "DOCUMENTO_ALTERADO");
  assert.deepEqual(newCapture.serproLastCheckedAt, checked.guia.serproLastCheckedAt);
  assert.equal(await a.guidePaymentObservation.count({ where: { guideReferenceId: recaptured.id } }), 2);
  assert.equal(newCapture.paymentStatus, "OPEN");
  ok("recaptura preserva observação/cronologia e versão alterada pede nova consulta");

  await a.guide.delete({ where: { id: same.id } });
  const retained = await a.guidePaymentObservation.findMany({ where: { guideReferenceId: same.id } });
  assert.equal(retained.length, 2);
  assert(retained.every(r => r.guideId === null));
  assert.equal(await a.accountingEntry.count(), accountingBefore);
  ok("histórico sobrevive à remoção da guia e observações não criam lançamentos");

  const scheduleNow = new Date();
  // Exercita o minuto salvo sem aguardar o relógio nem aceitar catch-up.
  scheduleNow.setUTCMinutes(0, 0, 0);
  Date.now = () => +scheduleNow;
  const scheduleConfig = { enabled: true, frequency: "DAILY", hour: localCalendar(scheduleNow).hour };
  const slot = describeSchedule(scheduleConfig, scheduleNow).dueAt;
  const scheduleKey = `fiscal_schedule:pagamento:${slot}`;
  assert.equal(await a.appSetting.findUnique({ where: { key: scheduleKey } }), null, "ensaio não sobrescreve agenda de outra execução");
  scheduleKeys.push(scheduleKey);
  let executions = 0;
  const scheduled = await Promise.all(clients.map(db => runScheduledRoutine("pagamento", scheduleConfig, async ({ assertActive }) => {
    assertActive();
    executions++;
    return { errors: 0, indeterminados: 1, cobertura: "PARCIAL", results: [] };
  }, { now: scheduleNow, db })));
  assert.equal(executions, 1);
  assert.equal(scheduled.filter(Boolean).length, 1);
  const scheduleRecord = await a.appSetting.findUnique({ where: { key: scheduleKey } });
  assert.equal(scheduleRecord.value.status, "SUCCEEDED");
  assert.equal(scheduleRecord.value.qualidadeConsulta, "PARCIAL");
  assert.equal(await runScheduledRoutine("pagamento", scheduleConfig, () => { throw Error("não repetir"); }, { now: scheduleNow, db: a }), null);
  ok("agenda local disparada pelo horário: duas conexões executam uma vez e persistem ressalva");

  const leaseRoutine = `${prefix}-lease`;
  const firstClaim = await claimScheduledRun({ routine: leaseRoutine, config: scheduleConfig, now: scheduleNow, db: a });
  scheduleKeys.push(firstClaim.key);
  const later = new Date(+scheduleNow + 6 * 60000);
  const nextClaim = await claimScheduledRun({ routine: leaseRoutine, config: scheduleConfig, now: later, db: b });
  assert.equal(nextClaim, null, "reserva expirada não autoriza outra consulta");
  // Troca sintética de propriedade verifica o lock sem reconsultar a obrigação.
  const replacement = { key: firstClaim.key, value: { ...firstClaim.value, owner: randomUUID() } };
  await b.appSetting.update({ where: { key: firstClaim.key }, data: { value: replacement.value } });
  assert.equal(await finishScheduledRun(firstClaim, {}, null, { db: a, now: later }), false);
  assert.equal(await finishScheduledRun(replacement, {}, null, { db: b, now: later }), true);
  ok("reserva expirada não reconsulta; mudança de proprietário impede finalização antiga");
  console.log(`PASS: ${checks} verificações PostgreSQL, dados sintéticos, sem HTTP/IA.`);
} finally {
  Date.now = realDateNow;
  // Identificadores UUID exclusivos desta execução. Nenhuma limpeza global.
  await a.guidePaymentObservation.deleteMany({ where: { guideReferenceId: { in: guideIds } } });
  await a.guide.deleteMany({ where: { id: { in: guideIds } } });
  await a.portalClient.deleteMany({ where: { id: companyId } });
  await a.appSetting.deleteMany({ where: { key: { in: scheduleKeys } } });
  await Promise.all([...clients, singleton].map(client => client.$disconnect()));
}
