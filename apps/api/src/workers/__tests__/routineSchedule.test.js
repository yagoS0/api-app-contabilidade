import { describeSchedule, localCalendar, previousCompetencia } from "../routineSchedule.js";

const cfg = (day, hour, frequency = "MONTHLY") => ({ enabled: true, day, hour, frequency });
test("00h no fuso do escritório dentro do minuto configurado", () => {
  const out = describeSchedule(cfg(9, 0), new Date("2026-09-09T03:00:45Z"));
  expect(out.dueAt).toBe("2026-09-09T03:00:00.000Z");
  expect(localCalendar(new Date(out.dueAt)).hour).toBe(0);
});
test.each([
  ["2026-09-30T17:00:30Z", "2026-10-31T17:00:00.000Z"],
  ["2026-02-28T17:00:30Z", "2026-03-31T17:00:00.000Z"],
  ["2028-02-29T17:00:30Z", "2028-03-31T17:00:00.000Z"],
])("não antecipa dia 31 para um dia que não foi configurado: %s", (now, next) => {
  expect(describeSchedule(cfg(31, 14), new Date(now))).toMatchObject({ dueAt: null, nextAt: next });
});
test("não antecipa extrato às 9h quando DAS está às 7h", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  expect(describeSchedule(cfg(9, 7), now).dueAt).toBe("2026-09-09T10:00:00.000Z");
  expect(describeSchedule(cfg(9, 9), now).dueAt).toBeNull();
});
test.each(["2026-09-09T10:01:00Z", "2026-09-10T10:00:00Z", "2026-09-11T10:00:00Z", "2026-09-12T10:00:00Z"])("não recupera horário perdido nem cria dias extras: %s", (now) => {
  const out = describeSchedule(cfg(9, 7), new Date(now));
  expect(out.dueAt).toBeNull();
  expect(out.nextAt).toBe("2026-10-09T10:00:00.000Z");
});
test("pagamento diário continua fora da janela mensal", () => {
  expect(describeSchedule(cfg(20, 8, "DAILY"), new Date("2026-09-24T11:00:10Z")).dueAt)
    .toBe("2026-09-24T11:00:00.000Z");
});
test.each([null, {}, { day: 9, hour: 7 }, { enabled: true }, { enabled: true, day: 9 }, { enabled: true, hour: 7 }, cfg(0, 7), cfg(9, 24), cfg(9, 7, "INVALID")])("configuração incompleta nunca autoriza consulta: %j", (config) => {
  expect(describeSchedule(config, new Date("2026-09-09T10:00:00Z"))).toMatchObject({ dueAt: null, nextAt: null });
});
test("rotina desabilitada não tem disparo", () => {
  expect(describeSchedule({ ...cfg(9, 7), enabled: false }).dueAt).toBeNull();
});
test("competência acompanha o calendário local na virada UTC", () => {
  expect(previousCompetencia(new Date("2026-10-01T01:00:00Z"))).toBe("2026-08");
  expect(previousCompetencia(new Date("2026-10-01T03:00:00Z"))).toBe("2026-09");
});
