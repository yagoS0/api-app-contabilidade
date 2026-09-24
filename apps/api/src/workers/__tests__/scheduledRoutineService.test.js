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
const now = new Date("2026-09-09T10:05:00Z");
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
test("falha tem espera e limite de tentativas", async () => {
  const db = memoryDb();
  for (let i = 0; i < 3; i += 1) {
    const at = new Date(now.getTime() + i * 16 * 60000);
    const claim = await claimScheduledRun({ routine: "das", config, now: at, db });
    expect(claim).not.toBeNull();
    await finishScheduledRun(claim, { failed: 1 }, null, { db, now: at });
    expect(await claimScheduledRun({ routine: "das", config, now: new Date(at.getTime() + 60000), db })).toBeNull();
  }
  expect(await claimScheduledRun({ routine: "das", config, now: new Date(now.getTime() + 60 * 60000), db })).toBeNull();
});
test("reserva expirada é retomada, dono antigo não finaliza a nova", async () => {
  const db = memoryDb();
  const first = await claimScheduledRun({ routine: "das", config, now, db });
  const next = await claimScheduledRun({ routine: "das", config, now: new Date(now.getTime() + 6 * 60000), db });
  expect(next.value.owner).not.toBe(first.value.owner);
  expect(await finishScheduledRun(first, {}, null, { db, now })).toBe(false);
  expect(db.rows.get(next.key).value.owner).toBe(next.value.owner);
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

test.each([{ parcelasErro: 1 }, { extratoErro: 1 }, { errors: 2 }, { naoConferiveis: 1 }])("falha parcial não aparece como conclusão: %j", async (result) => {
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
test("falha técnica continua com retentativa mesmo quando há ressalva fiscal", async () => {
  const db = memoryDb(); const claim = await claimScheduledRun({ routine: "pagamento", config, now, db });
  await finishScheduledRun(claim, { errors: 1, indeterminados: 1 }, null, { db, now });
  expect(db.rows.get(claim.key).value).toMatchObject({ status: "FAILED", qualidadeConsulta: "PARCIAL" });
  expect(await claimScheduledRun({ routine: "pagamento", config, now: new Date(now.getTime() + 16 * 60000), db })).not.toBeNull();
});
test("retomada do lote misto carrega só erro e conserva observação original das concluídas", async () => {
  jest.useFakeTimers().setSystemTime(now);
  const db = memoryDb();
  const confirmado = { guideId: "g-pago", status: "paid", resultadoConsulta: { estado: "CONFIRMADO", consultadoEm: now.toISOString() } };
  const inconclusivo = { guideId: "g-duvida", status: "indeterminado", resultadoConsulta: { estado: "INDETERMINADO", consultadoEm: now.toISOString() } };
  try {
    await runScheduledRoutine("pagamento", config, async () => ({ errors: 1, indeterminados: 1,
      results: [confirmado, inconclusivo, { guideId: "g-erro", status: "error" }] }), { now, db });
    const depois = new Date(now.getTime() + 16 * 60000); jest.setSystemTime(depois);
    const consultar = jest.fn(async ({ retomadaPagamento }) => ({ errors: 0, indeterminados: 1,
      results: [...retomadaPagamento.concluidos, { guideId: "g-erro", status: "paid" }] }));
    await runScheduledRoutine("pagamento", config, consultar, { now: depois, db });
    expect(consultar).toHaveBeenCalledWith(expect.objectContaining({ retomadaPagamento: {
      guideIds: ["g-erro"], parcelaIds: [], concluidos: [confirmado, inconclusivo],
    } }));
    const latest = [...db.rows.values()][0].value;
    expect(latest).toMatchObject({ status: "SUCCEEDED", qualidadeConsulta: "PARCIAL", retryAt: null });
    expect(latest.result.results[1].resultadoConsulta.consultadoEm).toBe(now.toISOString());
    expect(await claimScheduledRun({ routine: "pagamento", config, now: new Date(depois.getTime() + 16 * 60000), db })).toBeNull();
  } finally { jest.useRealTimers(); }
});

test("erro de parcela não transforma uma lista de guias vazia em carteira inteira", async () => {
  const db = memoryDb(); const claim = await claimScheduledRun({ routine: "pagamento", config, now, db });
  await finishScheduledRun(claim, { errors: 1, results: [{ guideId: "g", status: "open" }, { parcelaId: "p", status: "error" }] }, null, { db, now });
  const next = await claimScheduledRun({ routine: "pagamento", config, now: new Date(now.getTime() + 16 * 60000), db });
  expect(next.value.retomadaPagamento).toEqual({ guideIds: [], parcelaIds: ["p"], concluidos: [{ guideId: "g", status: "open" }] });
});