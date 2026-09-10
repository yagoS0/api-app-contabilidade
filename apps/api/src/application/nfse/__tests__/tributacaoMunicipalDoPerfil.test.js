import { tributacaoMunicipalDoPerfil, validarTributacaoMunicipal } from "../tributacaoMunicipalDoPerfil.js";

it("E0592: imunidade exige o tipo e proíbe tipo nas outras tributações", () => {
  expect(tributacaoMunicipalDoPerfil({ tribISSQN: "2", tpImunidade: "2" })).toBe("<tpImunidade>2</tpImunidade>");
  expect(validarTributacaoMunicipal({ tribISSQN: "2" })).toHaveLength(1);
  expect(validarTributacaoMunicipal({ tribISSQN: "1", tpImunidade: "2" })).toHaveLength(1);
});
it("E0585: suspensão exige operação tributável e processo de 30 dígitos", () => {
  const p = { tribISSQN: "1", exigSuspTipo: "1", exigSuspProcesso: "123456789012345678901234567890" };
  expect(tributacaoMunicipalDoPerfil(p)).toContain(`<nProcesso>${p.exigSuspProcesso}</nProcesso>`);
  expect(() => tributacaoMunicipalDoPerfil({ ...p, tribISSQN: "3" })).toThrow(/E0585/);
  expect(() => tributacaoMunicipalDoPerfil({ ...p, exigSuspProcesso: "123" })).toThrow(/30 dígitos/);
  expect(() => tributacaoMunicipalDoPerfil({ ...p, exigSuspTipo: null })).toThrow(/tipo de suspensão/);
});
it("não fabrica tags para empresas sem configuração", () => expect(tributacaoMunicipalDoPerfil(null)).toBe(""));
