import express from "express";
import request from "supertest";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({ requireFirmCompanyAccess: () => (req, res, next) => {
  if (req.params.companyId !== "minha") return res.status(403).json({ error: "forbidden" });
  req.auth = { user: { id: "contador", role: "contador" } }; next();
} }));
jest.mock("../../../application/notas/apuracao/v2/FechamentoService.js", () => ({
  transmitirFechamento: jest.fn(async () => ({ numeroDeclaracao: "simulada" })),
  calcularFechamento: jest.fn(),
  FechamentoError: class extends Error {},
}));
import { transmitirFechamento, calcularFechamento, FechamentoError } from "../../../application/notas/apuracao/v2/FechamentoService.js";
import { manualTasks } from "../../../application/tasks/ManualTaskService.js";
import { createApuracaoV2Router } from "../apuracaoV2.js";

let execute, start;
function app() {
  const a = express(); a.use(express.json());
  a.use("/companies/:companyId", createApuracaoV2Router({ log: { warn: jest.fn() } })); return a;
}
beforeEach(() => {
  execute = null; transmitirFechamento.mockClear();
  start = jest.spyOn(manualTasks, "start").mockImplementation(async (_descriptor, run) => { execute = run; return { id: "task-1", newlyStarted: true }; });
});
afterEach(() => start.mockRestore());

test('cálculo repetido informa espera sem expor detalhe interno', async () => {
  calcularFechamento.mockRejectedValueOnce(Object.assign(new Error('Aguarde antes de repetir.'), {
    code: 'SERPRO_CHAMADA_REPETIDA', detalhe: { segundosRestantes: 279, segredo: 'interno' },
  }));
  await request(app()).post('/companies/minha/fechamento/2026-09/calcular').set('Prefer', 'respond-async').send({}).expect(202);
  const result = await execute(jest.fn());
  expect(result.statusCode).toBe(409);
  expect(result.body).toMatchObject({ error: 'SERPRO_CHAMADA_REPETIDA', retryAfterSeconds: 279, action: 'aguardar_sem_repetir' });
  expect(JSON.stringify(result.body)).not.toContain('interno');
});

test('recusa de períodos devolve somente competências válidas para a revisão', async () => {
  calcularFechamento.mockRejectedValueOnce(Object.assign(new FechamentoError('Revise os períodos recusados.'), {
    code: 'RECEITAS_ANTERIORES_NAO_CONVERGIU', detalhe: { periodosRemovidos: { receitas: ['2026-01', '2026-99', 'segredo'], folhas: ['2025-12'] }, segredo: 'interno' },
  }));
  await request(app()).post('/companies/minha/fechamento/2026-09/calcular').set('Prefer', 'respond-async').send({}).expect(202);
  const result = await execute(jest.fn());
  expect(result.statusCode).toBe(400);
  expect(result.body.detalhe).toEqual({ periodosRemovidos: { receitas: ['2026-01'], folhas: ['2025-12'] } });
  expect(JSON.stringify(result.body)).not.toMatch(/interno|segredo/);
});

test("nega empresa alheia antes de aceitar transmissão em segundo plano", async () => {
  await request(app()).post("/companies/alheia/fechamento/2026-09/transmitir").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-09" }).expect(403);
  expect(start).not.toHaveBeenCalled(); expect(transmitirFechamento).not.toHaveBeenCalled();
});
test("a confirmação permanece obrigatória mesmo na execução adiada", async () => {
  await request(app()).post("/companies/minha/fechamento/2026-09/transmitir").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-08" }).expect(202);
  expect((await execute(jest.fn())).statusCode).toBe(400); expect(transmitirFechamento).not.toHaveBeenCalled();
});
test("executa uma vez com empresa, competência e cálculo preservados após aceite", async () => {
  await request(app()).post("/companies/minha/fechamento/2026-09/transmitir").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-09", calculoId: "calculo-1" }).expect(202);
  expect(transmitirFechamento).not.toHaveBeenCalled();
  const result = await execute(jest.fn()); expect(result.statusCode).toBe(200);
  expect(transmitirFechamento).toHaveBeenCalledTimes(1);
  expect(transmitirFechamento).toHaveBeenCalledWith({ portalClientId: "minha", competencia: "2026-09", userId: "contador", calculoId: "calculo-1" });
});
test("retificação exige a segunda confirmação sem transmitir nada", async () => {
  await request(app()).post("/companies/minha/fechamento/2026-09/retificar").set("Prefer", "respond-async").send({ confirmCompetencia: "2026-09" }).expect(202);
  expect((await execute(jest.fn())).body.error).toBe("confirm_retificar_required");
  expect(transmitirFechamento).not.toHaveBeenCalled();
});

 test.each([['CALCULO_EM_ANDAMENTO',409],['SERPRO_CHAMADA_EM_ANDAMENTO',409],['SERPRO_SIMULACAO_ANTERIOR_NAO_RECUPERAVEL',409],['SIMULACAO_RESPOSTA_INVALIDA',502],['PERIODOS_RECUSADOS_REGISTRO_INDISPONIVEL',503]])('expõe %s com status apropriado sem repetir', async (code,status) => {
 calcularFechamento.mockRejectedValueOnce(Object.assign(new Error('Operação interrompida. Nenhuma nova tentativa iniciada.'),{code}));
 await request(app()).post('/companies/minha/fechamento/2026-09/calcular').set('Prefer','respond-async').send({}).expect(202);
 const result=await execute(jest.fn());expect(result.statusCode).toBe(status);expect(result.body.error).toBe(code);
});
