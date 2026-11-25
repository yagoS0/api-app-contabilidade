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

const enderecoObra = { CEP: "01551-020", xLgr: " Rua A & B <teste> ", nro: "0", xCpl: " Bloco 'A' ", xBairro: " Centro " };
it("normaliza endereço nacional sem município ou UF e escapa XML em ordem", () => {
  expect(normalizarObra({ end: enderecoObra })).toEqual({ end: { CEP: "01551020", xLgr: "Rua A & B <teste>", nro: "0", xCpl: "Bloco 'A'", xBairro: "Centro" } });
  expect(xmlDadosEspeciais({ obra: { end: enderecoObra } }, { cTribNac: "070201" }).obra).toBe("<obra><end><CEP>01551020</CEP><xLgr>Rua A &amp; B &lt;teste&gt;</xLgr><nro>0</nro><xCpl>Bloco &apos;A&apos;</xCpl><xBairro>Centro</xBairro></end></obra>");
  expect(normalizarObra({ end: { ...enderecoObra, xCpl: "" } }).end).not.toHaveProperty("xCpl");
});
it.each([
  { end: null }, { end: [] }, { end: "Rua" }, { endExt: {} },
  { end: enderecoObra, cObra: "123" }, { end: enderecoObra, cCIB: "12345678" },
  ...["cMun", "UF", "endExt", "extra"].map(k => ({ end: { ...enderecoObra, [k]: "x" } })),
  ...["123", "abcdefgh", "01551.020", 1551020, null].map(CEP => ({ end: { ...enderecoObra, CEP } })),
  ...["", 0, null, "Rua\nA", "Rua\u0085A", "x".repeat(256)].map(xLgr => ({ end: { ...enderecoObra, xLgr } })),
  { end: { ...enderecoObra, nro: "x".repeat(61) } }, { end: { ...enderecoObra, xCpl: "x".repeat(157) } },
  { end: { ...enderecoObra, xBairro: "x".repeat(61) } },
])("recusa endereço inválido ou alternativa misturada: %j", obra => expect(() => normalizarObra(obra)).toThrow());
it("aceita limites do endereço sem alegar validar relação CEP/município", () => {
  expect(normalizarObra({ end: { CEP: "00000000", xLgr: "a".repeat(255), nro: "a".repeat(60), xCpl: "a".repeat(156), xBairro: "a".repeat(60) } }).end.CEP).toBe("00000000");
});
it.each(["070201", "070202", "070401", "070501", "070502", "070601", "070602", "070701", "070801", "071701", "071901", "141403", "141404"])("preserva lista E0370 e permite endereço: %s", cTribNac => {
  expect(() => xmlDadosEspeciais({}, { cTribNac })).toThrow(/E0370/);
  expect(xmlDadosEspeciais({ obra: { end: enderecoObra } }, { cTribNac }).obra).toContain("<end>");
});
it("990101 aceita endereço sem tornar obra obrigatória; E0372 não altera identificadores", () => {
  expect(xmlDadosEspeciais({}, { cTribNac: "990101" }).obra).toBe("");
  expect(xmlDadosEspeciais({ obra: { end: enderecoObra } }, { cTribNac: "990101" }).obra).toContain("<end>");
  expect(() => xmlDadosEspeciais({ obra: { end: enderecoObra } }, { cTribNac: "010101" })).toThrow(/E0372/);
  expect(xmlDadosEspeciais({ obra: { cObra: " A&B " } }, { cTribNac: "010101" }).obra).toBe("<obra><cObra>A&amp;B</cObra></obra>");
});

it("inscrição opcional acompanha endereço antes de end e respeita o limite", () => {
  const obra = { inscImobFisc: " A&B ", end: enderecoObra };
  expect(normalizarObra(obra).inscImobFisc).toBe("A&B");
  expect(xmlDadosEspeciais({ obra }, { cTribNac: "070201" }).obra).toContain("<obra><inscImobFisc>A&amp;B</inscImobFisc><end>");
  expect(normalizarObra({ end: enderecoObra, inscImobFisc: "" })).not.toHaveProperty("inscImobFisc");
  expect(normalizarObra({ end: enderecoObra, inscImobFisc: "a".repeat(30) }).inscImobFisc).toHaveLength(30);
  expect(normalizarObra({ end: enderecoObra, inscImobFisc: "A—B" }).inscImobFisc).toBe("A—B");
  for (const inscImobFisc of ["a".repeat(31), 123, "a\n"]) expect(() => normalizarObra({ end: enderecoObra, inscImobFisc })).toThrow();
});
it.each(["Rua 😀", "Rua — A", "Rua “A”"])("recusa alfabeto fora do XSD: %s", xLgr => {
  expect(() => normalizarObra({ end: { ...enderecoObra, xLgr } })).toThrow(/leiaute/);
});
it("preserva acentos e caracteres XML escapáveis", () => {
  expect(normalizarObra({ end: { ...enderecoObra, xLgr: "São João & Cia" } }).end.xLgr).toBe("São João & Cia");
});
