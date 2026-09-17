import { assinarMensagemHumana } from "../assinaturaAtendente.js";

test("nome de quem envia ocupa a primeira linha e mantém texto, links e formatação", () => {
  expect(assinarMensagemHumana("Olá!\n*Guia:* https://example.invalid/guia", { name: "Yago Silva" }))
    .toBe("*Yago Silva*\n\nOlá!\n*Guia:* https://example.invalid/guia");
});
test("reaplicar não duplica a identificação", () => {
  const texto = assinarMensagemHumana("Olá", { name: "Yago Silva" });
  expect(assinarMensagemHumana(texto, { name: "Yago Silva" })).toBe(texto);
});
test("nome ausente usa a equipe e não revela email", () => {
  expect(assinarMensagemHumana("Olá", { email: "interno@example.invalid" })).toBe("*Equipe Altan*\n\nOlá");
  expect(assinarMensagemHumana("Olá", { name: "interno@example.invalid" })).toBe("*Equipe Altan*\n\nOlá");
  expect(assinarMensagemHumana("Olá", { name: "id-interno", id: "id-interno" })).toBe("*Equipe Altan*\n\nOlá");
});
test("nome não injeta novas linhas ou formatação no cabeçalho", () => {
  expect(assinarMensagemHumana("Olá", { name: "  *Yago*\n_Silva_\u202E  " })).toBe("*Yago Silva*\n\nOlá");
});
test("anexo sem legenda ainda identifica o atendente", () => {
  expect(assinarMensagemHumana("", { name: "Yago" }, { limite: 1024 })).toBe("*Yago*");
});
test.each([4096, 1024])("a assinatura conta no limite de %s sem truncar a mensagem", limite => {
  const nome = { name: "Yago" }, espaco = "*Yago*\n\n".length;
  expect(assinarMensagemHumana("a".repeat(limite - espaco), nome, { limite })).toHaveLength(limite);
  expect(() => assinarMensagemHumana("a".repeat(limite - espaco + 1), nome, { limite }))
    .toThrow(expect.objectContaining({ code: "MENSAGEM_ASSINADA_LONGA", status: 400 }));
});
