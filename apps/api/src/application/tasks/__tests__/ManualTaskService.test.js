jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { createManualTaskService, captureTaskResponse, TASK_STALE_MS, snapshotTaskRequest, listTaskRecords } from "../ManualTaskService.js";

function setup() {
  const rows = [], scheduled = [];
  const matches = (r, where) => Object.entries(where).every(([k, v]) => k === "updatedAt" ? r.updatedAt < v.lt : r[k] === v);
  const model = {
    findUnique: jest.fn(async ({ where }) => rows.find(r => where.ownerId_requestKey ? r.ownerId === where.ownerId_requestKey.ownerId && r.requestKey === where.ownerId_requestKey.requestKey : r.activeKey === where.activeKey) || null),
    create: jest.fn(async ({ data }) => {
      if (rows.some(r => r.activeKey === data.activeKey || r.ownerId === data.ownerId && r.requestKey === data.requestKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row = { id: String(rows.length + 1), completed: 0, updatedAt: new Date(), ...data }; rows.push(row); return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const found = rows.filter(r => matches(r, where)); found.forEach(r => Object.assign(r, data, { updatedAt: new Date() })); return { count: found.length };
    }),
  };
  return { rows, scheduled, service: createManualTaskService({ db: { manualTask: model }, schedule: fn => scheduled.push(fn) }) };
}
const input = { ownerId: "user-a", requestKey: "request-1234567890", kind: "envio-guias", companyIds: ["company-a"], total: 2, fingerprint: "selection" };

test("contexto aceito preserva empresa, ator e competência após término da requisição", () => {
  const req = { params: { companyId: "a" }, body: { competencia: "2026-09" }, query: {}, auth: { user: { id: "u" } }, headers: {} };
  const snapshot = snapshotTaskRequest(req);
  req.params = {}; req.body.competencia = "2026-10"; req.auth.user.id = "outro";
  expect(snapshot.params.companyId).toBe("a"); expect(snapshot.body.competencia).toBe("2026-09"); expect(snapshot.auth.user.id).toBe("u");
});

test("histórico limitado não oculta tarefas em execução", async () => {
  const model = { findMany: jest.fn().mockResolvedValueOnce([{ id: "old-running" }]).mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ id: String(i) }))) };
  const tasks = await listTaskRecords(model, "running", { ownerId: "u" });
  expect(tasks).toHaveLength(201); expect(tasks[0].id).toBe("old-running");
  expect(model.findMany.mock.calls[0][0]).toEqual({ where: { ownerId: "u", status: "running" }, orderBy: { createdAt: "desc" } });
});

test("aceite é persistido antes da execução; reentrega não envia duas vezes e resultado fica salvo", async () => {
  const { service, rows, scheduled } = setup();
  const send = jest.fn(async progress => { await progress(1, { resultados: [{ ok: true }] }); return { body: { ok: true, resultados: [{ ok: true }, { ok: false }] } }; });
  const [a, b] = await Promise.all([service.start(input, send), service.start(input, send)]);
  expect(a.id).toBe(b.id); expect(send).not.toHaveBeenCalled(); expect(scheduled).toHaveLength(1);
  await scheduled[0]();
  expect(rows[0]).toMatchObject({ status: "partial", completed: 2, activeKey: null, result: { resultados: [{ ok: true }, { ok: false }] } });
  await service.start(input, send); expect(send).toHaveBeenCalledTimes(1); expect(scheduled).toHaveLength(1);
});

test("outra aba/usuário não inicia a mesma operação concorrente", async () => {
  const { service, scheduled } = setup();
  await service.start(input, jest.fn());
  await expect(service.start({ ...input, requestKey: "request-9876543210", ownerId: "other" }, jest.fn())).rejects.toMatchObject({ status: 409 });
  expect(scheduled).toHaveLength(1);
});

test("falha de transporte não é repetida, nem ao recuperar a tarefa", async () => {
  const { service, scheduled, rows } = setup();
  const run = jest.fn().mockRejectedValue(new Error("timeout after send"));
  await service.start(input, run); await scheduled[0](); await service.start(input, run);
  expect(run).toHaveBeenCalledTimes(1); expect(rows[0].status).toBe("interrupted");
});

test("trabalho sem heartbeat é interrompido e nunca retomado pela leitura", async () => {
  const { service, scheduled, rows } = setup();
  const run = jest.fn().mockResolvedValue({ body: { ok: true } });
  await service.start(input, run);
  rows[0].updatedAt = new Date(Date.now() - TASK_STALE_MS - 1000);
  await service.expire({ ownerId: "user-a" });
  expect(rows[0].status).toBe("interrupted"); expect(run).not.toHaveBeenCalled();
  // Um executor tardio não pode sobrescrever a interrupção como sucesso.
  await scheduled[0](); expect(rows[0].status).toBe("interrupted"); expect(run).not.toHaveBeenCalled();
});

test("validação de entrada impede tarefa sem identidade e adaptador preserva erro de negócio", async () => {
  const { service, scheduled } = setup();
  await expect(service.start({ ...input, ownerId: null }, jest.fn())).rejects.toMatchObject({ status: 400 });
  expect(scheduled).toHaveLength(0);
  expect(await captureTaskResponse(async res => res.status(422).json({ error: "CONFERENCIA_DIVERGENTE" })))
    .toEqual({ statusCode: 422, body: { error: "CONFERENCIA_DIVERGENTE" } });
});
