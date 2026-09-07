import { sugestoesDoPerfil, validarCatalogoPerfil } from "../catalogoPerfil.js";

it("preserva pares do catálogo e recusa produto cartesiano", () => {
  const sugestoes = sugestoesDoPerfil({ codigoServicoNacional: "100501" });
  const combos = sugestoes.porServico[0].combinacoes;
  expect(combos).toHaveLength(2);
  for (const c of combos) expect(validarCatalogoPerfil({ codigoServicoNacional: "100501", ibscbsCIndOp: c.cIndOp, ibscbsCClassTrib: c.cClassTrib })).toEqual([]);
  expect(validarCatalogoPerfil({ codigoServicoNacional: "100501", ibscbsCIndOp: combos[0].cIndOp, ibscbsCClassTrib: combos[1].cClassTrib })).toHaveLength(1);
});
it("sugere somente NBS terminais e não acrescenta serviços não cadastrados", () => {
  const r = sugestoesDoPerfil({ codigoServicoNacional: "100501", codigosServicoNacional: ["171901"] });
  expect(r.porServico.map((s) => s.codigo)).toEqual(["171901"]);
  expect(r.porServico[0].nbs.length).toBeGreaterThan(0);
  for (const n of r.porServico[0].nbs) expect(n.codigo.replace(/\D/g, "")).toHaveLength(9);
});
