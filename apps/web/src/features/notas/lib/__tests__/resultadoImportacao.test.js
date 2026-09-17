import { resultadoImportacao } from "../resultadoImportacao";
test("resposta ausente não anuncia importação concluída", () => {
  expect(resultadoImportacao(null, "NFSE")).toMatchObject({ falhou: true, mensagem: expect.stringContaining("Não foi possível confirmar") });
});
test("lote parcial preserva o sucesso e explica o XML da área errada por arquivo", () => {
  const r = resultadoImportacao({ created: 1, errors: [{ file: "venda.xml", reason: "nfe_na_area_nfse" }] }, "NFSE");
  expect(r.falhou).toBe(false); expect(r.quantidadeProblemas).toBe(1);
  expect(r.mensagem).toContain("1 nova(s)");
  expect(r.problemas[0]).toMatchObject({ arquivo: "venda.xml", mensagem: expect.stringContaining("não de serviço") });
});
test("lote totalmente incompatível é falha e mantém os motivos", () => {
  const r = resultadoImportacao({ errors: [{ file: "quebrado.xml", reason: "invalid_xml" }, { file: "outro.xml", reason: "formato_nao_suportado" }] }, "NFSE");
  expect(r.falhou).toBe(true); expect(r.problemas).toHaveLength(2);
  expect(r.problemas[0].mensagem).toContain("XML incompleto");
});
test("recusa de outro estabelecimento em ZIP não vira sucesso", () => {
  const r = resultadoImportacao({ ok: true, recusadas: 1, detalhes: [{ arquivo: "lote.zip", documento: "filial.xml", resultado: "recusada", motivo: "outro_estabelecimento" }] }, "NFE");
  expect(r.falhou).toBe(true); expect(r.problemas[0].arquivo).toBe("lote.zip / filial.xml");
  expect(r.problemas[0].mensagem).toContain("matriz ou filial");
});
