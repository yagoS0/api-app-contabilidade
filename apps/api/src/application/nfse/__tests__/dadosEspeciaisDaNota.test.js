import { normalizarObra, normalizarDestinatario, xmlDadosEspeciais } from "../dadosEspeciaisDaNota.js";
it("obra usa escolha exclusiva do XSD e respeita E0370", () => {
  expect(() => normalizarObra({ cObra: "123", cCIB: "12345678" })).toThrow();
  expect(() => xmlDadosEspeciais({}, { cTribNac: "070201" })).toThrow(/E0370/);
  expect(xmlDadosEspeciais({ obra: { cCIB: "12345678", inscImobFisc: "A&B" } }, { cTribNac: "070201" }).obra).toBe("<obra><inscImobFisc>A&amp;B</inscImobFisc><cCIB>12345678</cCIB></obra>");
});
it("destinatário exige documento, nome e bloco IBS/CBS", () => {
  expect(() => normalizarDestinatario({ cnpjCpf: "123", nome: "X" })).toThrow();
  const destinatario = { cnpjCpf: "12345678000199", nome: "A & B" };
  expect(() => xmlDadosEspeciais({ destinatario }, {})).toThrow(/IBS\/CBS/);
  const r = xmlDadosEspeciais({ destinatario }, { ibscbsInformado: true });
  expect(r.indDest).toBe("1");
  expect(r.destinatario).toBe("<dest><CNPJ>12345678000199</CNPJ><xNome>A &amp; B</xNome></dest>");
  expect(xmlDadosEspeciais({}, {}).indDest).toBe("0");
});
it("recusa formatos não suportados sem descartar campos", () => {
  expect(() => normalizarObra({ end: {} })).toThrow();
  expect(() => normalizarDestinatario({ NIF: "abc", nome: "X" })).toThrow();
});
