import { describeSchedule, localCalendar, previousCompetencia } from "../routineSchedule.js";

const cfg = (day, hour, frequency = "MONTHLY") => ({ enabled: true, day, hour, frequency });
test("00h no fuso do escritório e recuperação após o minuto programado", () => {
  const out = describeSchedule(cfg(9, 0), new Date("2026-09-09T03:17:00Z"));
  expect(out.dueAt).toBe("2026-09-09T03:00:00.000Z");
  expect(localCalendar(new Date(out.dueAt)).hour).toBe(0);
});
test.each([
  ["2026-09-30T18:00:00Z", "2026-09-30T17:00:00.000Z"],
  ["2026-02-28T18:00:00Z", "2026-02-28T17:00:00.000Z"],
  ["2028-02-29T18:00:00Z", "2028-02-29T17:00:00.000Z"],
])("dia 31 adapta ao último dia real: %s", (now, due) => {
  expect(describeSchedule(cfg(31, 14), new Date(now)).dueAt).toBe(due);
});
test("não antecipa extrato às 9h quando DAS está às 7h", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  expect(describeSchedule(cfg(9, 7), now).dueAt).toBe("2026-09-09T10:00:00.000Z");
  expect(describeSchedule(cfg(9, 9), now).dueAt).toBeNull();
});
test("recuperação é limitada, sem disparar dívida antiga indefinidamente", () => {
  expect(describeSchedule(cfg(9, 7), new Date("2026-09-15T10:00:00Z")).dueAt).toBeNull();
});
test("pagamento diário continua fora da janela mensal", () => {
  expect(describeSchedule(cfg(20, 8, "DAILY"), new Date("2026-09-24T12:00:00Z")).dueAt)
    .toBe("2026-09-24T11:00:00.000Z");
});
test("rotina desabilitada não tem disparo", () => {
  expect(describeSchedule({ ...cfg(9, 7), enabled: false }).dueAt).toBeNull();
});
test("competência acompanha o calendário local na virada UTC", () => {
  expect(previousCompetencia(new Date("2026-10-01T01:00:00Z"))).toBe("2026-08");
  expect(previousCompetencia(new Date("2026-10-01T03:00:00Z"))).toBe("2026-09");
});
