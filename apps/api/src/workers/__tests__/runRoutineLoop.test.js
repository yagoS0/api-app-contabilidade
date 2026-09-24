jest.mock("../../application/fiscal/serpro/SerproRuntimeSettings.js", () => ({ getSerproRuntimeSettings: jest.fn() }));
jest.mock("../../config.js", () => ({ log: { error: jest.fn() } }));
jest.mock("../scheduledRoutineService.js", () => ({ recordWorkerHeartbeat: jest.fn(), runScheduledRoutine: jest.fn() }));
import { getSerproRuntimeSettings } from "../../application/fiscal/serpro/SerproRuntimeSettings.js";
import { runScheduledRoutine } from "../scheduledRoutineService.js";
import { runRoutineTick } from "../runRoutineLoop.js";

const agenda = { enabled: true, rotinas: { das: { enabled: true, day: 9, hour: 7 }, extrato: { enabled: true, day: 9, hour: 7 } } };
beforeEach(() => {
  jest.clearAllMocks();
  getSerproRuntimeSettings.mockResolvedValue(agenda);
  runScheduledRoutine.mockImplementation(async (routine, config, run) => run({ routines: [routine], assertActive() {} }));
});

test("reserva horários iguais juntos e executa consultas em sequência", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const run = jest.fn(async ({ routines }) => { if (routines[0] === "das") await blocked; return {}; });
  const tick = runRoutineTick({ routines: ["das", "extrato"], run });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(runScheduledRoutine).toHaveBeenCalledTimes(2);
  expect(runScheduledRoutine.mock.calls[0][3].now).toEqual(runScheduledRoutine.mock.calls[1][3].now);
  expect(run).toHaveBeenCalledTimes(1);
  release();
  await tick;
  expect(run.mock.calls.map(([options]) => options.routines[0])).toEqual(["das", "extrato"]);
});

test("desativar ou alterar agenda enquanto aguarda impede consulta enfileirada", async () => {
  const run = jest.fn(async () => {
    getSerproRuntimeSettings.mockResolvedValue({ ...agenda, rotinas: { ...agenda.rotinas, extrato: { ...agenda.rotinas.extrato, enabled: false } } });
    return {};
  });
  await runRoutineTick({ routines: ["das", "extrato"], run });
  expect(run).toHaveBeenCalledTimes(1);
});

test("integração desligada não reserva consultas", async () => {
  getSerproRuntimeSettings.mockResolvedValue({ ...agenda, enabled: false });
  await runRoutineTick({ routines: ["das", "extrato"], run: jest.fn() });
  expect(runScheduledRoutine).not.toHaveBeenCalled();
});
