import { expedienteDoEscritorio, feriadoDoEscritorio } from "../expediente.js";
import { contextoDoTurno } from "../promptDoAssistente.js";

test.each([
  ["2026-09-08T11:59:00Z", false], ["2026-09-08T12:00:00Z", true],
  ["2026-09-08T19:59:59Z", true], ["2026-09-08T20:00:00Z", false],
  ["2026-09-12T15:00:00Z", false], ["2026-09-13T15:00:00Z", false],
])("fronteira local %s: aberto=%s", (instante, aberto) => {
  expect(expedienteDoEscritorio(new Date(instante)).aberto).toBe(aberto);
});
test.each(["2026-01-01", "2026-01-20", "2026-02-17", "2026-04-03", "2026-04-21", "2026-04-23", "2026-05-01", "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"])("feriado %s", (data) => {
  expect(feriadoDoEscritorio(data)).toBeTruthy();
  expect(expedienteDoEscritorio(new Date(`${data}T15:00:00Z`)).aberto).toBe(false);
});
test("sexta à noite pula fim de semana e feriado de segunda", () => {
  expect(expedienteDoEscritorio(new Date("2026-09-04T20:00:00Z")).proximaAbertura).toBe("2026-09-08T09:00:00-03:00");
});
test("ano seguinte e feriados móveis são calculados", () => {
  expect(expedienteDoEscritorio(new Date("2026-12-31T20:00:00Z")).proximaAbertura).toBe("2027-01-04T09:00:00-03:00");
  expect(feriadoDoEscritorio("2027-02-09")).toBe("Carnaval");
  expect(feriadoDoEscritorio("2027-03-26")).toBe("Sexta-feira Santa");
  expect(feriadoDoEscritorio("2027-05-27")).toBe("Corpus Christi");
});
test("pontos facultativos não suspendem o expediente", () => {
  expect(expedienteDoEscritorio(new Date("2026-02-18T12:00:00Z")).aberto).toBe(true);
  expect(expedienteDoEscritorio(new Date("2026-06-05T12:00:00Z")).aberto).toBe(true);
});
test("contexto informa retorno sem suspender a IA", () => {
  const contexto = contextoDoTurno({ hoje: new Date("2026-09-07T15:00:00Z") });
  expect(contexto).toContain("08/09/2026, às 9h");
  expect(contexto).toContain("A IA continua disponível");
});
