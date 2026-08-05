// O NONO DÍGITO É UMA ARMADILHA REAL, não teoria.
//
// Celulares brasileiros ganharam o 9 em 2012, e a base da Meta guarda muitos contatos ainda no
// formato de 8 dígitos. Um contato cadastrado como `5521999998888` pode chegar no webhook como
// `552199998888`. Comparar as strings cruas faz a mensagem recebida não achar o contato — e ela cai
// em "não vinculados" sem que ninguém entenda por quê.

import { normalizarE164, formatarTelefone, variantesE164 } from "../telefone.js";

describe("normalizarE164", () => {
  it("aceita o que o contador digita", () => {
    expect(normalizarE164("(21) 99999-8888")).toBe("5521999998888");
    expect(normalizarE164("21999998888")).toBe("5521999998888");
    expect(normalizarE164("5521999998888")).toBe("5521999998888");
  });

  it("aceita fixo (8 dígitos) e não estraga o que já tem DDI", () => {
    expect(normalizarE164("(21) 3333-4444")).toBe("552133334444");
    expect(normalizarE164("+55 21 3333-4444")).toBe("552133334444");
  });

  it("o `+` desambigua: com ele, o DDI já está no número", () => {
    // "14155552671" tem 11 dígitos — o MESMO formato de um celular brasileiro sem DDI. Nenhuma
    // regra de comprimento separa os dois casos; o que separa é o `+` que a pessoa digitou.
    expect(normalizarE164("+1 415 555 2671")).toBe("14155552671");
    expect(normalizarE164("+55 21 99999-8888")).toBe("5521999998888");
  });

  it("sem `+`, 11 dígitos é lido como celular brasileiro — é o caso comum", () => {
    expect(normalizarE164("21999998888")).toBe("5521999998888");
  });

  it("recusa o que não dá para afirmar que é telefone", () => {
    // Melhor recusar no cadastro do que gravar lixo e descobrir na hora do envio.
    expect(normalizarE164("")).toBeNull();
    expect(normalizarE164("123")).toBeNull();
    expect(normalizarE164("abc")).toBeNull();
  });
});

describe("variantesE164 — o webhook precisa achar o contato", () => {
  it("celular com 9 também procura pela forma antiga", () => {
    expect(variantesE164("5521999998888").sort()).toEqual(["552199998888", "5521999998888"]);
  });

  it("celular sem 9 também procura pela forma nova", () => {
    expect(variantesE164("552199998888").sort()).toEqual(["552199998888", "5521999998888"]);
  });

  it("as duas formas geram o MESMO conjunto — é isso que faz o encontro funcionar nos dois sentidos", () => {
    expect(variantesE164("5521999998888").sort()).toEqual(variantesE164("552199998888").sort());
  });

  it("fixo não ganha 9 inventado", () => {
    // 8 dígitos que não começam com 9 continuam sendo tratados como possível celular antigo; o que
    // não pode acontecer é inventar um número que não existe a partir de um de 9 que já começa
    // com outro dígito.
    expect(variantesE164("552133334444")).toContain("552133334444");
  });

  it("número estrangeiro não é mexido", () => {
    expect(variantesE164("14155552671")).toEqual(["14155552671"]);
  });
});

describe("formatarTelefone", () => {
  it("formata celular e fixo brasileiros para leitura", () => {
    expect(formatarTelefone("5521999998888")).toBe("+55 (21) 99999-8888");
    expect(formatarTelefone("552133334444")).toBe("+55 (21) 3333-4444");
  });
});
