// Somente PostgreSQL descartável. Executa serviços reais e transações concorrentes, sem HTTP.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const arg = process.argv.indexOf("--url");
const url = new URL(arg >= 0 ? process.argv[arg + 1] : "invalid:");
assert(url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.port === "55443"
  && url.pathname === "/altan_whatsapp_test" && url.username === "altan_test",
"Use apenas 127.0.0.1:55443/altan_whatsapp_test, usuário altan_test.");
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: "test", LOG_LEVEL: "silent",
  DOTENV_CONFIG_PATH: path.join(tmpdir(), `parcelamento-no-env-${randomUUID()}`) });
const noNetwork = () => { throw Error("Rede fiscal/HTTP proibida neste ensaio."); };
globalThis.fetch = http.request = http.get = https.request = https.get = noNetwork;
const { prisma: db } = await import("../src/infrastructure/db/prisma.js");
const { prepararParcelamentoDaGuia, vincularGuiaParcelamentoTx } = await import("../src/application/accounting/parcelamento/GuiaAvulsaParcelamentoService.js");
const { claimScheduledRun, finishScheduledRun } = await import("../src/workers/scheduledRoutineService.js");
const prefix = `parcelamento-check-${randomUUID()}`;
const companies = [], settingKeys = [];
let checks = 0;
const ok = text => console.log(`PASS ${++checks}: ${text}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function pauseAfterRead(tx, model, method, pause) {
  return new Proxy(tx, { get(target, key) {
    if (key !== model) return target[key];
    return new Proxy(target[key], { get(delegate, operation) {
      if (operation !== method) return delegate[operation];
      return async (...args) => { const result = await delegate[operation](...args); await pause(result); return result; };
    } });
  } });
}
async function fixture() {
  const company = await db.portalClient.create({ data: { razao: prefix, cnpj: `${prefix}-${companies.length}` } });
  companies.push(company.id);
  const source = await prepararParcelamentoDaGuia({ portalClientId: company.id, metadata: { isParcelamento: true, parcelamentoTipo: "PARCSN" }, client: db });
  assert.equal(source.numParcelas, null); assert.equal(source.aberturaEntryId, null);
  const target = await db.parcelamento.create({ data: { portalClientId: company.id, label: prefix, kind: "SIMPLES", tipo: "PARCSN", numeroParcelamento: randomUUID(), origem: "MANUAL" } });
  const guide = await db.guide.create({ data: { portalClientId: company.id, parcelamentoId: source.id, tipo: "SIMPLES", status: "PROCESSED", competencia: "2026-09", valor: 110, valorOriginal: 100, vencimento: new Date("2026-09-20T12:00:00Z"), pdfBytes: Buffer.from("%PDF-fixture"), extracted: { comprovante: { total: 100 } } } });
  const parcela = await db.parcela.create({ data: { portalClientId: company.id, parcelamentoId: source.id, guiaId: guide.id, origem: "GUIA", competencia: "2026-09", valorPrevisto: 110 } });
  return { company, source, target, guide, parcela, input: { portalClientId: company.id, guideId: guide.id, parcelamentoId: target.id, numeroParcela: null } };
}
const transact = fn => db.$transaction(fn, { timeout: 20000, maxWait: 10000 });
try {
  const [server] = await db.$queryRaw`SELECT current_database() AS db`;
  assert.equal(server.db, "altan_whatsapp_test");
  const dirs = (await readdir(new URL("../prisma/migrations/", import.meta.url), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  const applied = await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert(dirs.every(name => applied.some(m => m.migration_name === name)), "Todo o histórico deve estar aplicado");
  ok(`histórico completo aplicado (${dirs.length} migrations), incluindo campos anuláveis e fiscais`);

  const paid = await fixture();
  await db.parcela.update({ where: { id: paid.parcela.id }, data: { pagamentoStatus: "CONFIRMADO", valorPago: 100, pagamentoEvidencia: { comprovante: { total: 100, principal: 100, juros: 0, multa: 0 } } } });
  await db.guide.update({ where: { id: paid.guide.id }, data: { paymentStatus: "PAID" } });
  await transact(tx => vincularGuiaParcelamentoTx(tx, paid.input));
  const after = await db.parcela.findUnique({ where: { id: paid.parcela.id }, include: { guia: true } });
  assert.equal(after.parcelamentoId, paid.target.id); assert.equal(after.numeroParcela, null);
  assert.equal(Number(after.valorPago), 100); assert.equal(Number(after.guia.valor), 110);
  assert.deepEqual(after.pagamentoEvidencia.comprovante, { total: 100, principal: 100, juros: 0, multa: 0 });
  assert.equal(Buffer.from(after.guia.pdfBytes).toString(), "%PDF-fixture");
  await transact(tx => vincularGuiaParcelamentoTx(tx, paid.input));
  assert.equal(await db.parcela.count({ where: { guiaId: paid.guide.id } }), 1);
  ok("vínculo idempotente sem número mantém identidade/PDF e pagamento 100 separado do documento 110");

  const race = await fixture();
  const other = await db.parcelamento.create({ data: { portalClientId: race.company.id, label: prefix, kind: "SIMPLES", tipo: "PARCSN", numeroParcelamento: randomUUID() } });
  const gate = deferred(); let arrived = 0;
  const concurrent = await Promise.allSettled([race.target.id, other.id].map(parcelamentoId => transact(tx => vincularGuiaParcelamentoTx(pauseAfterRead(tx, "guide", "findFirst", async () => { if (++arrived === 2) gate.resolve(); await gate.promise; }), { ...race.input, parcelamentoId }))));
  assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(concurrent.find(r => r.status === "rejected").reason.code, "GUIA_ALTERADA");
  const winner = await db.guide.findUnique({ where: { id: race.guide.id }, include: { parcela: true } });
  assert.equal(winner.parcelamentoId, winner.parcela.parcelamentoId);
  assert.equal(await db.parcela.count({ where: { guiaId: race.guide.id } }), 1);
  ok("duas transações disputam a mesma guia: uma vence, a outra reverte sem vínculo dividido");

  for (const competing of ["target", "source"]) {
    const f = await fixture();
    const targetRow = await db.parcela.create({ data: { portalClientId: f.company.id, parcelamentoId: f.target.id, numeroParcela: 1, origem: "CONTRATO" } });
    const read = deferred(), resume = deferred();
    const work = transact(tx => vincularGuiaParcelamentoTx(pauseAfterRead(tx, "parcela", "findFirst", async () => { read.resolve(); await resume.promise; }), { ...f.input, numeroParcela: 1 }));
    const result = work.then(value => ({ value }), error => ({ error }));
    await read.promise;
    const changedId = competing === "target" ? targetRow.id : f.parcela.id;
    await db.parcela.update({ where: { id: changedId }, data: { pagamentoStatus: "CONFIRMADO", valorPago: 100, pagamentoEvidencia: { fixture: prefix } } });
    resume.resolve();
    assert.equal((await result).error?.code, "PARCELA_ALTERADA");
    assert.equal((await db.guide.findUnique({ where: { id: f.guide.id } })).parcelamentoId, f.source.id);
    assert.equal((await db.parcela.findUnique({ where: { id: changedId } })).pagamentoStatus, "CONFIRMADO");
    assert(await db.parcela.findUnique({ where: { id: targetRow.id } }), "rollback restaura previsão removida");
    ok(`pagamento concorrente na ${competing === "target" ? "prestação de destino" : "parcela de origem"} impede troca e preserva evidência`);
  }

  const now = new Date("2026-09-24T14:00:00Z"), config = { enabled: true, frequency: "DAILY", hour: 8 };
  const routine = prefix;
  const claims = await Promise.all(Array.from({ length: 12 }, () => claimScheduledRun({ routine, config, now, db })));
  const first = claims.find(Boolean); settingKeys.push(first.key);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(first.value.scheduledAt, "2026-09-24T11:00:00.000Z");
  assert.equal(await claimScheduledRun({ routine, config, now: new Date(now.getTime() + 60000), db }), null);
  const replacement = await claimScheduledRun({ routine, config, now: new Date(now.getTime() + 6 * 60000), db });
  assert(replacement); assert.notEqual(replacement.value.owner, first.value.owner);
  assert.equal(await finishScheduledRun(first, {}, null, { db, now }), false);
  assert.equal(await finishScheduledRun(replacement, { failed: 1 }, null, { db, now }), true);
  assert.equal(await claimScheduledRun({ routine, config, now: new Date(now.getTime() + 14 * 60000), db }), null);
  const retry = await claimScheduledRun({ routine, config, now: new Date(now.getTime() + 16 * 60000), db });
  assert.equal(retry.value.attempts, 3);
  await finishScheduledRun(retry, {}, null, { db, now });
  assert.equal(await claimScheduledRun({ routine, config, now: new Date(now.getTime() + 30 * 60000), db }), null);
  const independent = await claimScheduledRun({ routine: `${prefix}-payment`, config: { ...config, hour: 10 }, now, db });
  settingKeys.push(independent.key); assert.equal(independent.value.scheduledAt, "2026-09-24T13:00:00.000Z");
  ok("12 reservas reais: execução única, retomada de lease, dono antigo rejeitado, intervalo/limite e horários independentes");
  assert.equal(await db.accountingEntry.count({ where: { portalClientId: { in: companies } } }), 0);
  ok("todos os vínculos fiscais permanecem sem lançamentos automáticos");
  console.log(`PASS: ${checks} verificações em PostgreSQL real, sem rede externa.`);
} finally {
  await db.appSetting.deleteMany({ where: { key: { in: settingKeys } } });
  await db.guide.deleteMany({ where: { portalClientId: { in: companies } } });
  await db.portalClient.deleteMany({ where: { id: { in: companies } } });
  await db.$disconnect();
}
