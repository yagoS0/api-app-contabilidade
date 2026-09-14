jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { MENSAGENS_PADRAO } from "../MensagensPadrao.js";
import { criarRecursosComerciais } from "../RecursosComerciaisService.js";

test.each(MENSAGENS_PADRAO)("$chave prepara uma mensagem sem marcadores pendentes usando a configuração aprovada", async mensagem => {
  const db = { recursoComercial: {
    findUnique: async () => ({ ...mensagem, id: "msg", versao: 1, aprovadoEm: new Date() }),
    findFirst: async () => ({ dados: { escritorio: "Escritório teste", procuradorCnpj: "11222333000181", linkAutorizacao: "https://example.com/manual" } }),
  } };
  const r = await criarRecursosComerciais({ db }).prepararOrientacao("msg", { nome: "Pessoa teste", cnpj: "12345678000195", procuradorCnpj: "99999999999999", linkAutorizacao: "https://example.com/injetado" });
  expect(r.texto).not.toMatch(/\{\{|\}\}/);
  expect(r.texto).not.toContain("99999999999999");
  expect(r.texto).not.toContain("injetado");
  expect(r.texto.length).toBeLessThanOrEqual(4096);
  expect(mensagem.dados.descricao.trim()).not.toBe("");
  if (mensagem.chave === "autorizacao-acesso") {
    expect(r.texto).toContain("12345678000195"); expect(r.texto).toContain("11222333000181"); expect(r.texto).toContain("https://example.com/manual");
  }
});

test("guia de procuração não é preparado com CNPJ institucional ainda ausente", async () => {
  const db = { recursoComercial: { findUnique: async () => ({ ...MENSAGENS_PADRAO.find(m => m.chave === "autorizacao-acesso"), aprovadoEm: new Date() }), findFirst: async () => null } };
  await expect(criarRecursosComerciais({ db }).prepararOrientacao("msg", { cnpj: "12345678000195" })).rejects.toMatchObject({ code: "variaveis_ausentes" });
});
