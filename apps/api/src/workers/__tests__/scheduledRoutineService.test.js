jest.mock("../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { claimScheduledRun, finishScheduledRun, runScheduledRoutine } from "../scheduledRoutineService.js";

function memoryDb() {
  const rows = new Map();
  return { rows, appSetting: {
    findUnique: jest.fn(async ({ where }) => rows.has(where.key) ? structuredClone(rows.get(where.key)) : null),
    create: jest.fn(async ({ data }) => {
      if (rows.has(data.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows.set(data.key, structuredClone(data)); return data;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const row = rows.get(where.key);
      if (!row || JSON.stringify(row.value) !== JSON.stringify(where.value.equals)) return { count: 0 };
      rows.set(where.key, { ...row, ...structuredClone(data) }); return { count: 1 };
    }),
  } };
}
const config = { enabled: true, day: 9, hour: 7 };
const now = new Date("2026-09-09T10:00:05Z");
test("duas instâncias disputam o mesmo horário, só uma adquire", async () => {
  const db = memoryDb();
  const claims = await Promise.all([1, 2].map(() => claimScheduledRun({ routine: "das", config, now, db })));
  expect(claims.filter(Boolean)).toHaveLength(1);
});
test("sucesso persistido impede repetição após reinício", async () => {
  const db = memoryDb(); const claim = await claimScheduledRun({ routine: "das", config, now, db });
  await finishScheduledRun(claim, { failed: 0 }, null, { db, now });
  expect(await claimScheduledRun({ routine: "das", config, now: new Date(now.getTime() + 60000), db })).toBeNull();
});
test("falha nunca gera nova consulta no mesmo horário ou nos dias seguintes", async () => {
  const db = memoryDb();
  const claim = await claimScheduledRun({ routine: "das", config, now, db });
  await finishScheduledRun(claim, { failed: 1 }, null, { db, now });
  expect(db.rows.get(claim.key).value.retryAt).toBeNull();
  for (const delta of [1000, 16 * 60000, 24 * 3600000, 48 * 3600000]) {
    expect(await claimScheduledRun({ routine: "das", config, now: new Date(now.getTime() + delta), db })).toBeNull();
  }
  expect(await claimScheduledRun({ routine: "das", config, now: new Date("2026-10-09T10:00:05Z"), db })).not.toBeNull();
});
test("reserva expirada não repete chamada de resultado desconhecido", async () => {
  const db = memoryDb();
  const first = await claimScheduledRun({ routine: "das", config, now, db });
  const next = await claimScheduledRun({ routine: "das", config, now: new Date(now.getTime() + 6 * 60000), db });
  expect(next).toBeNull();
  expect(db.rows.get(first.key).value.attempts).toBe(1);
});

test("registro antigo com retry pendente também não autoriza nova consulta", async () => {
  const db = memoryDb();
  const claim = await claimScheduledRun({ routine: "das", config, now, db });
  db.rows.get(claim.key).value = { ...claim.value, status: "FAILED", retryAt: now.toISOString() };
  expect(await claimScheduledRun({ routine: "das", config, now, db })).toBeNull();
});

test("suspensão do processo além da reserva impede a próxima chamada mesmo antes do timer", async () => {
  jest.useFakeTimers().setSystemTime(now);
  const db = memoryDb();
  try {
    await expect(runScheduledRoutine("das", config, async ({ assertActive }) => {
      jest.setSystemTime(new Date(now.getTime() + 6 * 60000));
      assertActive();
    }, { now, db })).rejects.toMatchObject({ code: "SCHEDULE_LEASE_LOST" });
    expect([...db.rows.values()][0].value.status).toBe("FAILED");
  } finally { jest.useRealTimers(); }
});

test.each([{ parcelasErro: 1 }, { extratoErro: 1 }, { errors: 2 }, { naoConferiveis: 1 }, { avisosPendentes: 1 }])("falha parcial não aparece como conclusão: %j", async (result) => {
  const db = memoryDb();
  const claim = await claimScheduledRun({ routine: "parcelamento", config, now, db });
  await finishScheduledRun(claim, result, null, { db, now });
  expect(db.rows.get(claim.key).value.status).toBe("FAILED");
});

test.each([{ indeterminados: 2 }, { divergentes: 1 }, { semDoc: 1 }, { cobertura: "PARCIAL" }])("consulta incompleta registra ressalva sem repetir chamadas pagas: %j", async (result) => {
  const db = memoryDb(); const claim = await claimScheduledRun({ routine: "pagamento", config, now, db });
  await finishScheduledRun(claim, result, null, { db, now });
  expect(db.rows.get(claim.key).value).toMatchObject({ status: "SUCCEEDED", qualidadeConsulta: "PARCIAL", retryAt: null });
  expect(await claimScheduledRun({ routine: "pagamento", config, now: new Date(now.getTime() + 16 * 60000), db })).toBeNull();
});
test("falha técnica e ressalva fiscal exigem conferência sem retentativa automática", async () => {
  const db = memoryDb(); const claim = await claimScheduledRun({ routine: "pagamento", config, now, db });
  await finishScheduledRun(claim, { errors: 1, indeterminados: 1 }, null, { db, now });
  expect(db.rows.get(claim.key).value).toMatchObject({ status: "FAILED", qualidadeConsulta: "PARCIAL" });
  expect(db.rows.get(claim.key).value.retryAt).toBeNull();
  expect(await claimScheduledRun({ routine: "pagamento", config, now: new Date(now.getTime() + 1000), db })).toBeNull();
  expect(await claimScheduledRun({ routine: "pagamento", config, now: new Date(now.getTime() + 16 * 60000), db })).toBeNull();
});
test("lote misto conserva conclusões e falhas sem repetir a consulta programada", async () => {
  jest.useFakeTimers().setSystemTime(now);
  const db = memoryDb();
  const confirmado = { guideId: "g-pago", status: "paid", resultadoConsulta: { estado: "CONFIRMADO", consultadoEm: now.toISOString() } };
  const inconclusivo = { guideId: "g-duvida", status: "indeterminado", resultadoConsulta: { estado: "INDETERMINADO", consultadoEm: now.toISOString() } };
  try {
    await runScheduledRoutine("pagamento", config, async () => ({ errors: 1, indeterminados: 1,
      results: [confirmado, inconclusivo, { guideId: "g-erro", status: "error" }] }), { now, db });
    const depois = new Date(now.getTime() + 16 * 60000); jest.setSystemTime(depois);
    const consultar = jest.fn();
    await runScheduledRoutine("pagamento", config, consultar, { now: depois, db });
    expect(consultar).not.toHaveBeenCalled();
    const latest = [...db.rows.values()][0].value;
    expect(latest).toMatchObject({ status: "FAILED", qualidadeConsulta: "PARCIAL", retryAt: null });
    expect(latest.result.results).toEqual([confirmado, inconclusivo, { guideId: "g-erro", status: "error" }]);
    expect(latest.result.results[1].resultadoConsulta.consultadoEm).toBe(now.toISOString());
    expect(await claimScheduledRun({ routine: "pagamento", config, now: new Date(depois.getTime() + 16 * 60000), db })).toBeNull();
  } finally { jest.useRealTimers(); }
});

test("erro de parcela não dispara outra consulta automática da carteira", async () => {
  const db = memoryDb(); const claim = await claimScheduledRun({ routine: "pagamento", config, now, db });
  await finishScheduledRun(claim, { errors: 1, results: [{ guideId: "g", status: "open" }, { parcelaId: "p", status: "error" }] }, null, { db, now });
  const next = await claimScheduledRun({ routine: "pagamento", config, now: new Date(now.getTime() + 16 * 60000), db });
  expect(next).toBeNull();
  expect(db.rows.get(claim.key).value.result.results).toEqual([{ guideId: "g", status: "open" }, { parcelaId: "p", status: "error" }]);
});
