import { automacaoComercialBloqueada, trabalhoFiscalAnteriorARetomada } from "../automacaoComercialDoCaso.js";
const caso = { triagem: { retomadaManual: { bloqueiaAutomacao: true, em: "2026-10-20T12:00:00Z" } } };
test("bloqueio pertence ao caso, sem inferir pausa da pessoa", () => {
  expect(automacaoComercialBloqueada(caso)).toBe(true);
  expect(automacaoComercialBloqueada({ triagem: {} })).toBe(false);
});
test("trabalhos antigos ou sem data não são retomados; nova solicitação explícita pode seguir", () => {
  expect(trabalhoFiscalAnteriorARetomada(caso, {})).toBe(true);
  expect(trabalhoFiscalAnteriorARetomada(caso, { createdAt: "2026-10-19" })).toBe(true);
  expect(trabalhoFiscalAnteriorARetomada(caso, { createdAt: "2026-10-20T12:01:00Z" })).toBe(false);
});
