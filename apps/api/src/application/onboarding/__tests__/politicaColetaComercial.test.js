import { coletaComercialHabilitada } from "../politicaColetaComercial.js";

const telefone = "5511998887777";
const canal = { id: "comercial", finalidade: "COMERCIAL", ativo: true };
const habilitado = { flag: true, piloto: [], canal, canalId: canal.id, identidade: true, multicanal: true };

test("canal comercial cadastrado atende novos leads sem lista de telefones", () => {
  expect(coletaComercialHabilitada(telefone, habilitado)).toBe(true);
});
test.each([
  { flag: false }, { identidade: false }, { multicanal: false }, { canalId: "principal" },
  { canal: null }, { canalId: null }, { canal: { ...canal, ativo: false } },
  { canal: { ...canal, finalidade: "PRINCIPAL" } }, { canal: { ...canal, ativo: undefined } },
])("canal sem condição de entrada não amplia a audiência: %j", alteracao => {
  expect(coletaComercialHabilitada(telefone, { ...habilitado, ...alteracao })).toBe(false);
});
test("piloto anterior continua funcionando no principal, sem ampliar para outros números", () => {
  const principal = { flag: true, piloto: [telefone], identidade: false, multicanal: false };
  expect(coletaComercialHabilitada(telefone, principal)).toBe(true);
  expect(coletaComercialHabilitada("5511990000000", principal)).toBe(false);
});
