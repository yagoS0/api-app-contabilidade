import { sugestoesDoPerfil, validarCatalogoPerfil } from "../catalogoPerfil.js";

it("usa Anexo VIII como sugestão e confere códigos pela tabela oficial", () => {
  const sugestoes = sugestoesDoPerfil({ codigoServicoNacional: "100501" });
  const combos = sugestoes.porServico[0].combinacoes;
  expect(combos).toHaveLength(2);
  expect(sugestoes.orientativo).toBe(true);
  expect(validarCatalogoPerfil({ codigoServicoNacional:'171901', ibscbsCIndOp:'100301', ibscbsCClassTrib:'000001', ibscbsCst:'000' }, '2026-09-28')).toEqual([]);
  expect(validarCatalogoPerfil({ codigoServicoNacional:'171901', ibscbsCIndOp:'100301', ibscbsCClassTrib:'000001', ibscbsCst:'999' }, '2026-09-28').some(e=>e.campo==='ibscbsCst')).toBe(true);
});
it("sugere somente NBS terminais e não acrescenta serviços não cadastrados", () => {
  const r = sugestoesDoPerfil({ codigoServicoNacional: "100501", codigosServicoNacional: ["171901"] });
  expect(r.porServico.map((s) => s.codigo)).toEqual(["171901"]);
  expect(r.porServico[0].nbs.length).toBeGreaterThan(0);
  for (const n of r.porServico[0].nbs) expect(n.codigo.replace(/\D/g, "")).toHaveLength(9);
});
