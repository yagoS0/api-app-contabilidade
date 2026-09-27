import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createManualTaskService, TASK_STALE_MS } from "../src/application/tasks/ManualTaskService.js";

const url = process.env.TASK_TEST_DATABASE_URL;
if (!url) throw new Error("TASK_TEST_DATABASE_URL required");
const parsed = new URL(url);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/tasks_test") throw new Error("Only disposable local tasks_test database allowed");
const db = new PrismaClient({ datasources: { db: { url } } });
const ownerId = `tasks-test-${randomUUID()}`, callbacks = [];
const service = createManualTaskService({ db, schedule: fn => callbacks.push(fn) });
let sends = 0;
const input = { ownerId, requestKey: randomUUID(), kind: "test-send", companyIds: [ownerId], total: 2, fingerprint: "same-operation" };
try {
  const run = async progress => {
    sends++; await progress(1, { resultados: [{ ok: true, texto: "Confirmado" }] });
    return { body: { ok: true, resultados: [{ ok: true }, { ok: false, texto: "Falha simulada" }] } };
  };
  const accepted = await Promise.all(Array.from({ length: 16 }, () => service.start(input, run)));
  assert.equal(new Set(accepted.map(t => t.id)).size, 1); assert.equal(callbacks.length, 1); assert.equal(sends, 0);
  await assert.rejects(service.start({ ...input, requestKey: randomUUID() }, run), err => err.status === 409);
  await callbacks.shift()(); assert.equal(sends, 1);
  const saved = await db.manualTask.findUnique({ where: { id: accepted[0].id } });
  assert.equal(saved.status, "partial"); assert.equal(saved.result.resultados.length, 2); assert.equal(saved.completed, 2);
  await service.start(input, run); assert.equal(callbacks.length, 0); assert.equal(sends, 1);
  const secondConnection = new PrismaClient({ datasources: { db: { url } } });
  try { assert.equal((await secondConnection.manualTask.findUnique({ where: { id: saved.id } })).status, "partial"); }
  finally { await secondConnection.$disconnect(); }
  const stopped = await service.start({ ...input, requestKey: randomUUID() }, run);
  await db.manualTask.update({ where: { id: stopped.id }, data: { updatedAt: new Date(Date.now() - TASK_STALE_MS - 1000) } });
  await service.expire({ ownerId }); await callbacks.shift()();
  assert.equal(sends, 1); assert.equal((await db.manualTask.findUnique({ where: { id: stopped.id } })).status, "interrupted");
  const failed = await service.start({ ...input, requestKey: randomUUID() }, async progress => { await progress(1, { confirmado: true }); throw new Error("transport unknown"); });
  await callbacks.shift()();
  const final = await db.manualTask.findUnique({ where: { id: failed.id } });
  assert.equal(final.status, "interrupted"); assert.equal(final.completed, 1); assert.equal(final.progress.confirmado, true);
  console.log("8 verificações PostgreSQL aprovadas: concorrência, conflito entre requisições, persistência, resultado parcial, reentrega, reconexão, interrupção sem replay e progresso preservado. Zero chamadas externas.");
} finally {
  await db.manualTask.deleteMany({ where: { ownerId } });
  await db.$disconnect();
}
