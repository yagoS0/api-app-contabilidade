import { sugestoesDoPerfil, validarCatalogoPerfil } from "../catalogoPerfil.js";

it('oferece tabela NBS completa terminal e CST oficial para busca sem ampliar serviços habilitados', () => {
  const r = sugestoesDoPerfil({ codigoServicoNacional: '170601' });
  expect(r.nbs.length).toBeGreaterThan(900);
  expect(r.nbs.every(n => n.codigo.replace(/\D/g, '').length === 9)).toBe(true);
  expect(r.nbs.some(n => /gestão de/i.test(n.descricao))).toBe(true);
  expect(r.tabelasRtc.csts).toContainEqual(expect.objectContaining({ codigo: '000', descricao: 'Tributação integral' }));
  expect(r.porServico.map(s => s.codigo)).toEqual(['170601']);
});

it("preserva sugestões e permite combinações oficiais fora da correlação orientativa", () => {
  const sugestoes = sugestoesDoPerfil({ codigoServicoNacional: "100501" });
  const combos = sugestoes.porServico[0].combinacoes;
  expect(combos).toHaveLength(2);
  for (const c of combos) expect(validarCatalogoPerfil({ codigoServicoNacional: "100501", ibscbsCIndOp: c.cIndOp, ibscbsCClassTrib: c.cClassTrib })).toEqual([]);
  expect(validarCatalogoPerfil({ codigoServicoNacional: "100501", ibscbsCIndOp: combos[0].cIndOp, ibscbsCClassTrib: combos[1].cClassTrib })).toEqual([]);
});
it("recusa códigos inexistentes, CST incompatível e classificação de outro documento fiscal", () => {
  expect(validarCatalogoPerfil({ ibscbsCIndOp: '999999' })[0].codigo).toBe('NFSE_IBSCBS_INDOP_INVALIDO');
  expect(validarCatalogoPerfil({ ibscbsCst: '999' })[0].codigo).toBe('NFSE_IBSCBS_CST_INVALIDO');
  expect(validarCatalogoPerfil({ ibscbsCst: '200', ibscbsCClassTrib: '000001' })[0].codigo).toBe('NFSE_IBSCBS_CST_INCOMPATIVEL');
  expect(validarCatalogoPerfil({ ibscbsCClassTrib: '000002' })[0].codigo).toBe('NFSE_IBSCBS_CLASSIFICACAO_NAO_NFSE');
});
it("sugere somente NBS terminais e não acrescenta serviços não cadastrados", () => {
  const r = sugestoesDoPerfil({ codigoServicoNacional: "100501", codigosServicoNacional: ["171901"] });
  expect(r.porServico.map((s) => s.codigo)).toEqual(["171901"]);
  expect(r.porServico[0].nbs.length).toBeGreaterThan(0);
  for (const n of r.porServico[0].nbs) expect(n.codigo.replace(/\D/g, "")).toHaveLength(9);
});
